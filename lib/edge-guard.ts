import { NextResponse, type NextRequest } from "next/server";
import { LOOPBACK_HEADER, fromLoopback, sameSecret } from "@/lib/edge-peer";

/**
 * Only our nginx may talk to this site. The container also sits on the shared
 * edge network with other projects' containers, which could otherwise call it
 * directly and forge X-Endod-Client-IP (the platform's per-IP rate limits).
 * nginx adds X-Endod-Edge-Key (= EDGE_SHARED_SECRET) to every request; proxy.ts
 * checks it first, for pages, API routes and assets alike.
 *
 * - Production (an https SITE_ORIGIN): without a valid key, 403; without a
 *   configured key (32+ characters), 503 for everything.
 * - The one exception: the Docker HEALTHCHECK, a GET of HEALTH_PATH from
 *   127.0.0.1 or ::1 (the Dockerfile probes http://127.0.0.1:${PORT}/api/health).
 * - Development and tests (SITE_ORIGIN not https): no check.
 *
 * The key is never logged, echoed or passed on (see withoutEdgeHeaders).
 */

export const EDGE_KEY_HEADER = "x-endod-edge-key";
export const HEALTH_PATH = "/api/health";

const MIN_SECRET_LENGTH = 32;

/** Production is an https SITE_ORIGIN (as in lib/server/platform.ts). */
function isProduction(): boolean {
  return (process.env.SITE_ORIGIN ?? "").trim().startsWith("https://");
}

function refuse(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

let warned = false;

/** A response refusing the request, or null when it may go on. */
export function checkEdgeKey(request: NextRequest): NextResponse | null {
  if (!isProduction()) return null;
  const secret = process.env.EDGE_SHARED_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) {
    if (!warned) {
      warned = true;
      console.warn(
        `EDGE_SHARED_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters: refusing every request with 503 until it is set.`,
      );
    }
    return refuse(503, "The pharmacy site is not configured. Contact Endod support.");
  }
  const presented = request.headers.get(EDGE_KEY_HEADER);
  if (presented !== null && sameSecret(presented, secret)) return null;
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    request.nextUrl.pathname === HEALTH_PATH &&
    fromLoopback(request.headers)
  ) {
    return null;
  }
  return refuse(403, "Forbidden.");
}

/** Lets the request go on without the edge key and the loopback marker. */
export function withoutEdgeHeaders(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete(EDGE_KEY_HEADER);
  headers.delete(LOOPBACK_HEADER);
  return NextResponse.next({ request: { headers } });
}
