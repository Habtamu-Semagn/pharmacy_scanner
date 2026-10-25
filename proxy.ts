import type { NextRequest } from "next/server";
import { checkEdgeKey, withoutEdgeHeaders } from "@/lib/edge-guard";

/**
 * Runs first on every request (no matcher): only our nginx may call this site
 * (lib/edge-guard.ts). The edge key never reaches pages or route handlers.
 */
export function proxy(request: NextRequest) {
  return checkEdgeKey(request) ?? withoutEdgeHeaders(request);
}
