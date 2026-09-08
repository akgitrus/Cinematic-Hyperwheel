"""
Proof-of-work request gating.

Rather than trusting any client-supplied identity (IP, headers, cookies),
protected endpoints require the caller to have recently spent real CPU
time solving a hashcash-style puzzle: find a nonce such that
SHA-256(challenge || nonce) has at least `difficulty_bits` leading zero
bits. The cost of finding such a nonce grows exponentially with the
difficulty and does not depend on how many network identities (IPs) the
caller controls - unlike a per-IP counter, this can't be diluted by
spreading requests across many addresses.

Flow:
  1. GET /api/pow/challenge?scope=<scope> -> {challenge, difficulty}
     `challenge` is a short-lived, HMAC-signed, self-contained token
     (scope + timestamp + random salt + signature) - the server does not
     need to remember it was issued, only reject it once it has been
     redeemed or has expired (see _spent_challenges below).
  2. The client solves the puzzle (see the frontend Web Worker) and
     redeems it via POST /api/pow/solve -> {ticket, calls_remaining}.
  3. `ticket` is an opaque, randomly generated id worth a fixed number of
     calls to endpoints in the same scope (see SCOPES) within a short
     window - so a search box firing several requests per second while
     the user types doesn't need a fresh proof for every keystroke, while
     the amount of API usage one proof buys stays bounded and
     proportional to the difficulty actually paid for.

Both the pending-challenge and ticket stores are plain in-process dicts
with lazy, probabilistic expiry sweeps - no external cache dependency,
and no assumption beyond a single backend worker process, matching how
this app already keeps other request-scoped state (see wheel.py's basis,
tmdb.py's image cache).
"""
from __future__ import annotations

import hashlib
import hmac
import os
import random
import secrets
import sys
import time
from dataclasses import dataclass


def _load_secret() -> bytes:
    secret = os.environ.get("POW_SECRET")
    if secret:
        return secret.encode()
    # Same graceful-degradation spirit as a missing TMDB_API_KEY (see
    # tmdb.py): proof-of-work still works with a random per-process
    # secret, it just means a restart or a multi-worker deployment
    # invalidates/desyncs outstanding challenges. Set POW_SECRET
    # explicitly for a stable, multi-worker production deployment.
    print(
        "[warning] POW_SECRET not set - using an ephemeral per-process "
        "secret. Set POW_SECRET for a stable, multi-worker deployment.",
        file=sys.stderr,
    )
    return secrets.token_bytes(32)


_SECRET = _load_secret()
CHALLENGE_TTL_S = 120       # how long a client has to solve one puzzle
_SWEEP_CHANCE = 0.02        # probability of an opportunistic cleanup pass


@dataclass(frozen=True)
class Scope:
    """One protected-endpoint difficulty tier."""
    difficulty_bits: int   # required leading zero BITS in the SHA-256 digest
    calls_per_ticket: int  # how many requests one solved proof is worth
    ticket_ttl_s: int      # how long a ticket stays redeemable


# Difficulty is calibrated by cost, not by a fixed request count: "heavy"
# (recommend.py's full-catalog Stage A/B pass, run once per circle) asks
# for meaningfully more client-side work per ticket than "light" (search,
# wheel), which fires far more often per user action (every keystroke,
# every scroll-driven active-circle change).
SCOPES: dict[str, Scope] = {
    "light": Scope(difficulty_bits=16, calls_per_ticket=30, ticket_ttl_s=120),
    "heavy": Scope(difficulty_bits=20, calls_per_ticket=8, ticket_ttl_s=180),
}

# challenge string -> expiry timestamp; rejects reuse of an already-
# redeemed (or expired) challenge - see redeem_challenge().
_spent_challenges: dict[str, float] = {}
# ticket id -> [scope, remaining uses, expiry timestamp]
_tickets: dict[str, list] = {}


def _sweep(store: dict, expiry_index: int | None = None) -> None:
    """Opportunistic cleanup, run with small probability on the hot path
    instead of a background thread/timer - keeps this module free of any
    lifecycle to start or stop, and free of any dependency beyond the
    standard library."""
    if random.random() > _SWEEP_CHANCE:
        return
    now = time.time()
    expired = (
        [k for k, exp in store.items() if exp < now]
        if expiry_index is None
        else [k for k, v in store.items() if v[expiry_index] < now]
    )
    for k in expired:
        del store[k]


def issue_challenge(scope: str) -> dict:
    if scope not in SCOPES:
        raise ValueError(f"Unknown proof-of-work scope: {scope!r}")
    ts = str(int(time.time()))
    salt = secrets.token_hex(8)
    payload = f"{scope}:{ts}:{salt}"
    signature = hmac.new(_SECRET, payload.encode(), hashlib.sha256).hexdigest()
    return {"challenge": f"{payload}:{signature}", "difficulty": SCOPES[scope].difficulty_bits}


def _leading_zero_bits(digest_hex: str) -> int:
    """Leading zero BITS (not just hex nibbles) in a hex digest - bit-level
    granularity gives finer difficulty steps than 4-bit nibble jumps."""
    value = int(digest_hex, 16)
    total_bits = len(digest_hex) * 4
    return total_bits if value == 0 else total_bits - value.bit_length()


def _verify_signature(challenge: str) -> str | None:
    """Returns the challenge's scope if its signature and freshness check
    out, else None."""
    try:
        scope, ts, salt, signature = challenge.split(":")
    except ValueError:
        return None
    if scope not in SCOPES:
        return None
    expected = hmac.new(_SECRET, f"{scope}:{ts}:{salt}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return None
    if time.time() - int(ts) > CHALLENGE_TTL_S:
        return None
    return scope


def redeem_challenge(challenge: str, nonce: str) -> dict | None:
    """Verifies a solved puzzle and, if valid, mints a fresh ticket for
    that challenge's scope. Returns {"ticket", "calls_remaining"}, or None
    if the challenge is invalid, expired, already redeemed, or the nonce
    doesn't actually solve the puzzle at the required difficulty."""
    _sweep(_spent_challenges)

    scope = _verify_signature(challenge)
    if scope is None:
        return None
    if challenge in _spent_challenges:
        return None  # a solved proof is single-use

    digest = hashlib.sha256(f"{challenge}:{nonce}".encode()).hexdigest()
    if _leading_zero_bits(digest) < SCOPES[scope].difficulty_bits:
        return None

    _spent_challenges[challenge] = time.time() + CHALLENGE_TTL_S
    cfg = SCOPES[scope]
    ticket_id = secrets.token_urlsafe(24)
    _tickets[ticket_id] = [scope, cfg.calls_per_ticket, time.time() + cfg.ticket_ttl_s]
    return {"ticket": ticket_id, "calls_remaining": cfg.calls_per_ticket}


def consume_ticket(ticket_id: str | None, required_scope: str) -> bool:
    """Spends one use of `ticket_id` if it exists, matches the required
    scope, still has uses left, and hasn't expired."""
    _sweep(_tickets, expiry_index=2)

    if not ticket_id:
        return False
    entry = _tickets.get(ticket_id)
    if entry is None:
        return False
    scope, remaining, expires_at = entry
    if scope != required_scope or remaining <= 0 or expires_at < time.time():
        return False
    entry[1] -= 1
    return True