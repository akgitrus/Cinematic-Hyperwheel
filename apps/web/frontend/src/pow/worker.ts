/**
 * Solves a proof-of-work puzzle off the main thread: finds a nonce such
 * that SHA-256(`${challenge}:${nonce}`) has at least `difficulty` leading
 * zero bits. Runs entirely here so mining never blocks the UI.
 */
import { sha256, leadingZeroBits } from "./sha256";

export interface PowRequest {
  challenge: string;
  difficulty: number;
}

const encoder = new TextEncoder();

self.onmessage = (event: MessageEvent<PowRequest>) => {
  const { challenge, difficulty } = event.data;
  let nonce = 0;
  // A plain incrementing counter is enough: the challenge itself already
  // carries a random server-issued salt, so two callers' search spaces
  // never collide in a way that matters here.
  while (true) {
    const candidate = String(nonce);
    const digest = sha256(encoder.encode(`${challenge}:${candidate}`));
    if (leadingZeroBits(digest) >= difficulty) {
      (self as unknown as Worker).postMessage({ nonce: candidate });
      return;
    }
    nonce++;
  }
};