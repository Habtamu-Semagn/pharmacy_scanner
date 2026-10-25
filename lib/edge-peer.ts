import http from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Which requests really come from this container itself (the Docker
 * HEALTHCHECK)? Proxy only sees headers, and every header a client sends can be
 * forged (Next fills X-Forwarded-For from the socket only when the client did
 * not send one). So, at server start (instrumentation.ts), we wrap the HTTP
 * server: for each request it drops any incoming LOOPBACK_HEADER and, when the
 * TCP peer is 127.0.0.1 or ::1, sets it to a random per-process nonce that no
 * client can know. Proxy then compares it in constant time.
 */

export const LOOPBACK_HEADER = "x-endod-loopback";

const NONCE_KEY = "__endodLoopbackNonce";
type WithNonce = typeof globalThis & { [NONCE_KEY]?: string };

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function markLoopbackRequests(): void {
  const global = globalThis as WithNonce;
  if (global[NONCE_KEY]) return;
  const nonce = randomBytes(32).toString("hex");
  global[NONCE_KEY] = nonce;
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (this: http.Server, event: string | symbol, ...args: unknown[]) {
    if (event === "request") {
      const request = args[0] as http.IncomingMessage;
      delete request.headers[LOOPBACK_HEADER];
      if (LOOPBACK_ADDRESSES.has(request.socket?.remoteAddress ?? "")) {
        request.headers[LOOPBACK_HEADER] = nonce;
      }
    }
    return emit.apply(this, [event, ...args] as Parameters<typeof emit>);
  } as typeof emit;
}

/** Constant-time equality of two strings of any length. */
export function sameSecret(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

/** True only for a request whose TCP peer was this machine (see above). */
export function fromLoopback(headers: Headers): boolean {
  const nonce = (globalThis as WithNonce)[NONCE_KEY];
  const value = headers.get(LOOPBACK_HEADER);
  return Boolean(nonce && value && sameSecret(value, nonce));
}
