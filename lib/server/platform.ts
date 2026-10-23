// Server-only: talks to the Endod platform API (docs/endod-api.md §2).
// Never import this from a client component; it reads PHARMACY_API_KEY.

import type { NextRequest } from "next/server";
import {
  CODE_RE,
  PHONE_RE,
  isToken,
  normalisePhone,
  sanitizePrescription,
  type RxStatus,
} from "@/lib/rx";

const TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 8 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Json = Record<string, unknown>;

export function json(body: Json, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

const fail = (status: number, error: string, extra?: Record<string, string>) =>
  json({ error }, status, extra);

// ---------------------------------------------------------------- request guards

function expectedOrigins(req: NextRequest): Set<string> {
  const configured = (process.env.SITE_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (configured.length) return new Set(configured);
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host");
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ||
    req.nextUrl.protocol.replace(/:$/, "");
  return host ? new Set([`${proto}://${host}`]) : new Set();
}

/**
 * Refuses anything that is not a same-origin JSON POST within the size limit.
 * Returns the parsed body, or a Response to send back.
 */
export async function readGuardedJson(req: NextRequest): Promise<Json | Response> {
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  if (!origin || !expectedOrigins(req).has(origin) || (fetchSite && fetchSite !== "same-origin")) {
    return fail(403, "Cross-origin requests are not allowed.");
  }

  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return fail(415, "Send JSON.");

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return fail(413, "Request is too large.");

  // Read the stream ourselves so a missing/false Content-Length cannot bypass the cap.
  const reader = req.body?.getReader();
  if (!reader) return fail(400, "Empty request.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return fail(413, "Request is too large.");
    }
    chunks.push(value);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return fail(400, "Invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail(400, "Invalid request.");
  }
  return parsed as Json;
}

/** The pharmacist's IP for the platform's rate limits. */
export function clientIp(req: NextRequest): string {
  const valid = (v: string | null | undefined) =>
    v && v.length <= 45 && /^[0-9a-fA-F:.]+$/.test(v) ? v : null;
  const cf = valid(req.headers.get("cf-connecting-ip")?.trim());
  if (cf) return cf;
  // The right-most entry is the one our own proxy (nginx) added; entries to
  // its left are whatever the client claimed.
  const xff = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const fromXff = valid(xff[xff.length - 1]);
  if (fromXff) return fromXff;
  return valid(req.headers.get("x-real-ip")?.trim()) ?? "0.0.0.0";
}

export function idempotencyKey(req: NextRequest): string | null {
  const key = req.headers.get("idempotency-key")?.trim();
  return key && UUID_RE.test(key) ? key.toLowerCase() : null;
}

// ---------------------------------------------------------------- body validation

type Ref = { token: string } | { code: string; phone: string };

export function parseRef(body: Json): Ref | null {
  if (body.token !== undefined) {
    return isToken(body.token) ? { token: body.token } : null;
  }
  if (typeof body.code === "string" && typeof body.phone === "string") {
    const code = body.code.trim();
    const phone = normalisePhone(body.phone);
    if (CODE_RE.test(code) && PHONE_RE.test(phone)) return { code, phone };
  }
  return null;
}

export interface DispenseBody {
  pharmacy_name: string;
  pharmacist_name: string | null;
  items: { item_index: number; amount: number | null; complete: boolean }[];
}

export function parseDispense(body: Json): DispenseBody | string {
  const name = typeof body.pharmacy_name === "string" ? body.pharmacy_name.trim() : "";
  if (name.length < 2 || name.length > 120) return "Enter the pharmacy name (2 to 120 characters).";

  let pharmacist: string | null = null;
  if (body.pharmacist_name !== undefined && body.pharmacist_name !== null) {
    if (typeof body.pharmacist_name !== "string") return "Invalid pharmacist name.";
    pharmacist = body.pharmacist_name.trim() || null;
    if (pharmacist && pharmacist.length > 120) return "Pharmacist name is too long.";
  }

  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100) {
    return "Choose what is given now.";
  }
  const seen = new Set<number>();
  const items: DispenseBody["items"] = [];
  for (const raw of body.items) {
    if (!raw || typeof raw !== "object") return "Invalid item.";
    const it = raw as Json;
    const idx = it.item_index;
    if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx > 10_000 || seen.has(idx)) {
      return "Invalid item.";
    }
    seen.add(idx);
    const amount = it.amount ?? null;
    if (amount !== null && (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 1e6)) {
      return "Amounts must be more than 0.";
    }
    if (typeof it.complete !== "boolean") return "Invalid item.";
    if (amount === null && !it.complete) return "Each item needs an amount or 'given fully'.";
    items.push({ item_index: idx, amount, complete: it.complete });
  }
  return { pharmacy_name: name, pharmacist_name: pharmacist, items };
}

// ---------------------------------------------------------------- platform call

const CLOSED_MESSAGES: Record<Exclude<RxStatus, "open">, string> = {
  completed: "Everything on this prescription has already been given.",
  expired: "This prescription has expired and can no longer be dispensed.",
  retracted: "The hospital has withdrawn this prescription. Do not dispense it.",
};

function closedStatusIn(body: unknown): Exclude<RxStatus, "open"> | null {
  const pick = (v: unknown) =>
    v === "completed" || v === "expired" || v === "retracted" ? v : null;
  if (!body || typeof body !== "object") return null;
  const b = body as Json;
  const fromDetail =
    b.detail && typeof b.detail === "object" ? pick((b.detail as Json).status) : null;
  return pick(b.status) ?? fromDetail;
}

export async function callPlatform(
  path: "/pharmacy/lookup" | "/pharmacy/dispense",
  payload: Json,
  req: NextRequest,
  idemKey?: string,
): Promise<Response> {
  const base = (process.env.PLATFORM_API_URL || "http://endod-platform-api:8000").replace(/\/+$/, "");
  const key = process.env.PHARMACY_API_KEY;
  if (!key) {
    console.error("PHARMACY_API_KEY is not set");
    return fail(500, "The pharmacy site is not configured. Contact Endod support.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Pharmacy-Key": key,
    "X-Client-IP": clientIp(req),
  };
  if (idemKey) headers["Idempotency-Key"] = idemKey;

  let res: Response;
  try {
    res = await fetch(base + path, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    console.error(`platform ${path} failed:`, timedOut ? "timeout" : e instanceof Error ? e.message : e);
    return fail(
      timedOut ? 504 : 502,
      "Endod is unreachable right now. Check the connection and try again.",
    );
  }

  let body: unknown = null;
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (res.ok) {
    const rx = sanitizePrescription(body);
    if (!rx) return fail(502, "Endod sent an unexpected answer. Try again.");
    return json({ prescription: rx });
  }

  switch (res.status) {
    case 404:
      return fail(
        404,
        "No prescription found. Check the code and the patient's phone number, or scan the QR again.",
      );
    case 409: {
      const closed = closedStatusIn(body);
      if (closed) return json({ error: CLOSED_MESSAGES[closed], status: closed }, 409);
      return fail(409, "That is more than what is left on the prescription. Reload it and check the amounts.");
    }
    case 429: {
      const retry = res.headers.get("retry-after");
      return fail(
        429,
        "Too many attempts from this pharmacy. Wait a while before trying again.",
        retry && /^\d{1,6}$/.test(retry) ? { "Retry-After": retry } : undefined,
      );
    }
    case 400:
    case 422:
      return fail(400, "Endod did not accept the request. Check the details and try again.");
    case 401:
    case 403:
      console.error(`platform ${path} refused the pharmacy key (${res.status})`);
      return fail(502, "The pharmacy site is not configured correctly. Contact Endod support.");
    default:
      console.error(`platform ${path} answered ${res.status}`);
      return fail(502, "Endod had a problem. Try again in a moment.");
  }
}
