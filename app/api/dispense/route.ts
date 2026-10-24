import type { NextRequest } from "next/server";
import {
  callPlatform,
  idempotencyKey,
  json,
  parseDispense,
  parseRef,
  readGuardedJson,
} from "@/lib/server/platform";

export async function POST(req: NextRequest) {
  const body = await readGuardedJson(req);
  if (body instanceof Response) return body;

  const key = idempotencyKey(req);
  if (!key) return json({ error: "Missing Idempotency-Key." }, 400);

  const ref = parseRef(body);
  if (!ref) return json({ error: "Invalid prescription reference." }, 400);

  const dispense = parseDispense(body);
  if (typeof dispense === "string") return json({ error: dispense }, 400);

  return callPlatform("/pharmacy/dispense", { ...ref, ...dispense }, req, key);
}
