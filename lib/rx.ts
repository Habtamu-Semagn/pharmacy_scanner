// Shared, browser-safe types and helpers for Endod prescriptions.
// The shapes follow docs/endod-api.md section 2.

export type RxStatus = "open" | "completed" | "expired" | "retracted";
export type ItemStatus = "not_given" | "partly_given" | "given";

export interface RxItem {
  item_index: number;
  drug: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  duration: string | null;
  quantity_text: string | null;
  quantity_total: number | null;
  given_total: number | null;
  status: ItemStatus;
  notes: string | null;
}

export interface DispenseLine {
  item_index: number;
  amount: number | null;
  complete: boolean;
}

export interface Dispense {
  at: string;
  pharmacy_name: string;
  items: DispenseLine[];
}

export interface Prescription {
  rx_id: string;
  status: RxStatus;
  hospital_name: string;
  doctor_name: string | null;
  written_at: string | null;
  expires_at: string | null;
  patient: {
    name: string;
    dedan_id: string;
    age: number | null;
    sex: string | null;
  };
  notes: string | null;
  items: RxItem[];
  dispenses: Dispense[];
}

/** Who the prescription is looked up by: the QR token, or SMS code + phone. */
export type RxRef = { token: string } | { code: string; phone: string };

export const ENDOD_RX_ORIGIN = "https://pharmacy.endod-health.com";

// `<rx_id>.<signature>`: 32 hex, then 22 chars of base64url (§1).
export const TOKEN_RE = /^[0-9a-fA-F]{32}\.[A-Za-z0-9_-]{22}$/;
export const CODE_RE = /^\d{6}$/;
// Ethiopian numbers as typed: 09.., 07.., 9.., +2519.., 2519..
export const PHONE_RE = /^\+?\d{9,15}$/;

export function isToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

export function normalisePhone(raw: string): string {
  return raw.replace(/[\s\-().]/g, "");
}

/**
 * Turns the text of a scanned QR into a token, or null when it is not an
 * Endod prescription. Only `https://pharmacy.endod-health.com/rx/<token>` is
 * accepted, plus the same path on `currentOrigin` (for local development).
 */
export function tokenFromScan(text: string, currentOrigin?: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const allowed = new Set([ENDOD_RX_ORIGIN]);
  if (currentOrigin) allowed.add(currentOrigin);
  if (!allowed.has(url.origin)) return null;
  if (url.username || url.password) return null;
  const m = /^\/rx\/([^/]+)\/?$/.exec(url.pathname);
  if (!m) return null;
  let token: string;
  try {
    token = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  return isToken(token) ? token : null;
}

const TZ = "Africa/Addis_Ababa";

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function formatQty(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** What is still to be given for an item with a known total, else null. */
export function remaining(item: RxItem): number | null {
  if (item.quantity_total === null) return null;
  return Math.max(0, item.quantity_total - (item.given_total ?? 0));
}

/** Strict pick of the documented lookup/dispense response fields. */
export function sanitizePrescription(raw: unknown): Prescription | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max = 500): string | null =>
    typeof v === "string" ? v.slice(0, max) : null;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const statuses: RxStatus[] = ["open", "completed", "expired", "retracted"];
  const itemStatuses: ItemStatus[] = ["not_given", "partly_given", "given"];

  const rxId = str(r.rx_id, 64);
  const status = statuses.find((s) => s === r.status);
  if (!rxId || !status) return null;

  const p = (r.patient && typeof r.patient === "object" ? r.patient : {}) as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items : [];
  const dispenses = Array.isArray(r.dispenses) ? r.dispenses : [];

  return {
    rx_id: rxId,
    status,
    hospital_name: str(r.hospital_name, 200) ?? "",
    doctor_name: str(r.doctor_name, 200),
    written_at: str(r.written_at, 64),
    expires_at: str(r.expires_at, 64),
    patient: {
      name: str(p.name, 200) ?? "",
      dedan_id: str(p.dedan_id, 64) ?? "",
      age: num(p.age),
      sex: str(p.sex, 32),
    },
    notes: str(r.notes, 2000),
    items: items.slice(0, 100).flatMap((x): RxItem[] => {
      if (!x || typeof x !== "object") return [];
      const i = x as Record<string, unknown>;
      const idx = num(i.item_index);
      if (idx === null) return [];
      return [
        {
          item_index: idx,
          drug: str(i.drug, 300) ?? "",
          dose: str(i.dose, 200),
          route: str(i.route, 200),
          frequency: str(i.frequency, 200),
          duration: str(i.duration, 200),
          quantity_text: str(i.quantity_text, 200),
          quantity_total: num(i.quantity_total),
          given_total: num(i.given_total),
          status: itemStatuses.find((s) => s === i.status) ?? "not_given",
          notes: str(i.notes, 1000),
        },
      ];
    }),
    dispenses: dispenses.slice(0, 200).flatMap((x): Dispense[] => {
      if (!x || typeof x !== "object") return [];
      const d = x as Record<string, unknown>;
      const lines = Array.isArray(d.items) ? d.items : [];
      return [
        {
          at: str(d.at, 64) ?? "",
          pharmacy_name: str(d.pharmacy_name, 120) ?? "",
          items: lines.slice(0, 100).flatMap((y): DispenseLine[] => {
            if (!y || typeof y !== "object") return [];
            const l = y as Record<string, unknown>;
            const idx = num(l.item_index);
            if (idx === null) return [];
            return [{ item_index: idx, amount: num(l.amount), complete: l.complete === true }];
          }),
        },
      ];
    }),
  };
}
