/**
 * Client-side view of the proof-of-work ticket described in
 * apps/web/backend/app/pow.py: solves a puzzle once, then lets a batch of
 * subsequent protected requests spend it, minting a fresh one only once
 * the current ticket is exhausted or missing. The server remains the
 * actual source of truth on remaining uses - the local counter only
 * exists to avoid firing a request the server would reject for a ticket
 * already known to be spent.
 */

interface Ticket {
  id: string;
  remaining: number;
}

const tickets = new Map<string, Ticket>();
const pendingMints = new Map<string, Promise<string>>();

function solveInWorker(challenge: string, difficulty: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ nonce: string }>) => {
      worker.terminate();
      resolve(e.data.nonce);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(e);
    };
    worker.postMessage({ challenge, difficulty });
  });
}

async function mintTicket(scope: string): Promise<string> {
  const { challenge, difficulty } = await fetch(`/api/pow/challenge?scope=${scope}`).then((r) => r.json());
  const nonce = await solveInWorker(challenge, difficulty);
  const res = await fetch("/api/pow/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenge, nonce }),
  });
  if (!res.ok) throw new Error("proof-of-work redemption failed");
  const { ticket: id, calls_remaining: remaining } = await res.json();
  tickets.set(scope, { id, remaining });
  return id;
}

/** Resolves to a ticket id with at least one remaining use for `scope`,
 * minting (and solving) a fresh one if needed. Concurrent callers for the
 * same scope share a single in-flight mint instead of each solving their
 * own puzzle. */
export async function getTicket(scope: string): Promise<string> {
  const existing = tickets.get(scope);
  if (existing && existing.remaining > 0) {
    existing.remaining -= 1;
    return existing.id;
  }

  let pending = pendingMints.get(scope);
  if (!pending) {
    pending = mintTicket(scope).finally(() => pendingMints.delete(scope));
    pendingMints.set(scope, pending);
  }
  const id = await pending;
  const ticket = tickets.get(scope);
  if (ticket) ticket.remaining -= 1;
  return id;
}

/** Drops the locally cached ticket for `scope` - called when the server
 * reports it as exhausted/expired (a 429 from require_pow, see main.py),
 * so the next getTicket() call mints a fresh one instead of retrying the
 * same id. */
export function invalidateTicket(scope: string): void {
  tickets.delete(scope);
}