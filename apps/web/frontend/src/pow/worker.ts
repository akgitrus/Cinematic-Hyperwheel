/**
 * Solves a proof-of-work puzzle off the main thread: finds a nonce such
 * that SHA-256(`${challenge}:${nonce}`) has at least `difficulty` leading
 * zero bits. Runs entirely here so mining never blocks the UI.
 */
import { minePow } from "./sha256";

export interface PowRequest {
  challenge: string;
  difficulty: number;
}

self.onmessage = (event: MessageEvent<PowRequest>) => {
  const { challenge, difficulty } = event.data;
  const nonce = minePow(challenge, difficulty);
  (self as unknown as Worker).postMessage({ nonce });
};