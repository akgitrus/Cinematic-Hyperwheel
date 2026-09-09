/**
 * Minimal, dependency-free SHA-256 (FIPS 180-4), specialized for the
 * proof-of-work mining loop (see worker.ts).
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

// Leading zero BITS across the eight 32-bit digest words, matching the
// server's bit-level check (see backend app/pow.py's
// _leading_zero_bits) without ever serializing the digest to bytes -
// h0 holds the digest's most significant 32 bits, h7 its least
// significant. Math.clz32 already treats its argument as an unsigned
// 32-bit integer, so the signed `| 0` results from the compression
// rounds below don't need converting first.
function leadingZeroBits256(
  h0: number, h1: number, h2: number, h3: number,
  h4: number, h5: number, h6: number, h7: number
): number {
  if (h0 !== 0) return Math.clz32(h0);
  if (h1 !== 0) return 32 + Math.clz32(h1);
  if (h2 !== 0) return 64 + Math.clz32(h2);
  if (h3 !== 0) return 96 + Math.clz32(h3);
  if (h4 !== 0) return 128 + Math.clz32(h4);
  if (h5 !== 0) return 160 + Math.clz32(h5);
  if (h6 !== 0) return 192 + Math.clz32(h6);
  if (h7 !== 0) return 224 + Math.clz32(h7);
  return 256;
}

// Decimal digits a nonce can ever need before this loop would already
// have run for an utterly unrealistic number of attempts (edging on
// Number.MAX_SAFE_INTEGER) - sized generously since it only affects a
// one-time buffer allocation, not the hot path.
const MAX_NONCE_DIGITS = 20;

/**
 * Finds the smallest nonce >= 0 such that
 * SHA-256(`${challengePrefix}:${nonce}`) has at least `difficulty`
 * leading zero bits, and returns it as a decimal string (matching what
 * the server's redeem_challenge expects - see backend app/pow.py).
 */
export function minePow(challengePrefix: string, difficulty: number): string {
  const prefixBytes = new TextEncoder().encode(`${challengePrefix}:`);
  const prefixLen = prefixBytes.length;

  // Padded message buffer, sized for the worst-case nonce length and
  // reused for every attempt - only the bytes that actually change
  // (the nonce's digits, the 0x80 end-of-message marker, and the
  // trailing bit-length) are rewritten per attempt below.
  const maxMessageLen = prefixLen + MAX_NONCE_DIGITS;
  const bufLen = ((maxMessageLen + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(bufLen);
  buf.set(prefixBytes, 0);
  const view = new DataView(buf.buffer);
  const w = new Uint32Array(64); // message schedule, reused every block/attempt
  const digits = new Uint8Array(MAX_NONCE_DIGITS); // scratch, reused every attempt

  let prevPaddedLen = -1; // forces a one-time full clear on the first attempt

  for (let nonce = 0; ; nonce++) {
    // Nonce's decimal digits, written MSB-first - no
    // String(nonce)/TextEncoder round trip per attempt.
    let n = nonce;
    let digitCount = 0;
    if (n === 0) {
      digits[0] = 48; // '0'
      digitCount = 1;
    } else {
      while (n > 0) {
        digits[digitCount++] = 48 + (n % 10);
        n = Math.floor(n / 10);
      }
    }

    const messageLen = prefixLen + digitCount;
    const paddedLen = ((messageLen + 9 + 63) >> 6) << 6;

    // digitCount only grows over the run, so paddedLen only grows too;
    // on the rare attempt where it crosses into a fresh 64-byte block,
    // that block's tail may still hold an earlier attempt's bit-length
    // bytes in what is now supposed to be zero-padding - clear it once,
    // here, before writing this attempt's content.
    if (paddedLen !== prevPaddedLen) {
      buf.fill(0, prefixLen, bufLen);
      prevPaddedLen = paddedLen;
    }

    for (let i = 0; i < digitCount; i++) {
      buf[prefixLen + i] = digits[digitCount - 1 - i];
    }
    buf[messageLen] = 0x80;
    view.setUint32(paddedLen - 4, (messageLen * 8) >>> 0, false);

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    for (let offset = 0; offset < paddedLen; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }

      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + temp1) | 0;
        d = c; c = b; b = a; a = (temp1 + temp2) | 0;
      }

      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }

    if (leadingZeroBits256(h0, h1, h2, h3, h4, h5, h6, h7) >= difficulty) {
      return String(nonce);
    }
  }
}