// Browser helpers: calls this site's own /api routes (never the platform).

import type { Prescription, RxRef } from "@/lib/rx";

export type ApiResult =
  | { ok: true; prescription: Prescription }
  | { ok: false; status: number; error: string; rxStatus?: string; retryable: boolean };

async function post(path: string, body: unknown, headers?: Record<string, string>): Promise<ApiResult> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: "No connection to the pharmacy site. Check the internet connection and try again.",
      retryable: true,
    };
  }
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* keep empty */
  }
  if (res.ok && data.prescription) {
    return { ok: true, prescription: data.prescription as Prescription };
  }
  return {
    ok: false,
    status: res.status,
    error: typeof data.error === "string" ? data.error : "Something went wrong. Try again.",
    rxStatus: typeof data.status === "string" ? data.status : undefined,
    // Network trouble and server errors may not have reached Endod: same key, try again.
    retryable: res.status >= 500 || res.status === 0,
  };
}

export function lookup(ref: RxRef): Promise<ApiResult> {
  return post("/api/lookup", ref);
}

export interface DispenseRequest {
  pharmacy_name: string;
  pharmacist_name: string | null;
  items: { item_index: number; amount: number | null; complete: boolean }[];
}

export function dispense(ref: RxRef, req: DispenseRequest, idempotencyKey: string): Promise<ApiResult> {
  return post("/api/dispense", { ...ref, ...req }, { "Idempotency-Key": idempotencyKey });
}

export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID needs a secure context; plain-http LAN dev falls back here.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Code lookups keep the code and phone out of the URL: they live in this
// tab's sessionStorage and are read by /rx/code.
const CODE_KEY = "endod.rx.codeLookup";

export function saveCodeLookup(ref: { code: string; phone: string }, rx: Prescription) {
  try {
    sessionStorage.setItem(CODE_KEY, JSON.stringify({ ref, rx }));
  } catch {
    /* private mode: /rx/code will ask to enter the code again */
  }
}

export function readCodeLookup(): { ref: { code: string; phone: string }; rx: Prescription } | null {
  try {
    const raw = sessionStorage.getItem(CODE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearCodeLookup() {
  try {
    sessionStorage.removeItem(CODE_KEY);
  } catch {
    /* ignore */
  }
}

const PHARMACY_KEY = "endod.pharmacyName";

export function rememberedPharmacy(): string {
  try {
    return localStorage.getItem(PHARMACY_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberPharmacy(name: string) {
  try {
    localStorage.setItem(PHARMACY_KEY, name);
  } catch {
    /* ignore */
  }
}
