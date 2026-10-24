import type { NextRequest } from "next/server";
import { callPlatform, json, parseRef, readGuardedJson } from "@/lib/server/platform";

export async function POST(req: NextRequest) {
  const body = await readGuardedJson(req);
  if (body instanceof Response) return body;

  const ref = parseRef(body);
  if (!ref) {
    return json(
      { error: "Scan the prescription QR, or enter the 6-digit code and the patient's phone number." },
      400,
    );
  }
  return callPlatform("/pharmacy/lookup", ref, req);
}
