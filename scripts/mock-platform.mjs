#!/usr/bin/env node
// In-memory stand-in for the Endod platform's pharmacy API (docs/endod-api.md §2),
// for local development and the Playwright tests. Not for production.
//
//   PHARMACY_API_KEY   key the site must send (default: dev-pharmacy-key)
//   MOCK_PLATFORM_PORT port (default: 8787)
//   RX_SIGNING_KEY     HMAC secret for QR tokens (default: a fixed dev secret)
//
// Extra endpoints for tests (mock only): POST /__reset, GET /__requests,
// GET /__samples, and POST /__slow-next-dispense?ms=N (the next dispense is
// recorded but answered only after N ms, to simulate a timeout after commit).

import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.MOCK_PLATFORM_PORT || 8787);
const API_KEY = process.env.PHARMACY_API_KEY || "dev-pharmacy-key";
const SIGNING_KEY = process.env.RX_SIGNING_KEY || "mock-rx-signing-key";
const HOUR = 60 * 60 * 1000;

const rxIdFor = (name) => crypto.createHash("md5").update(`mock-rx:${name}`).digest("hex");
const sign = (rxId) =>
  crypto.createHmac("sha256", SIGNING_KEY).update(`rx:${rxId}`).digest("base64url").slice(0, 22);
const tokenFor = (rxId) => `${rxId}.${sign(rxId)}`;

const days = (n) => new Date(Date.now() + n * 24 * HOUR).toISOString();

function item(item_index, drug, dose, route, frequency, duration, quantity_text, notes = null) {
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(quantity_text ?? "");
  return {
    item_index,
    drug,
    dose,
    route,
    frequency,
    duration,
    quantity_text,
    quantity_total: m ? Number(m[1]) : null,
    given_total: 0,
    status: "not_given",
    notes,
  };
}

function samples() {
  const patient = { name: "Abebe Tadesse Worku", dedan_id: "ED-4F7K-92QX", age: 42, sex: "male" };
  const base = (key, extra) => ({
    rx_id: rxIdFor(key),
    status: "open",
    hospital_name: "Felege Hiwot Comprehensive Specialized Hospital",
    doctor_name: "Dr. Dawit Mengistu",
    written_at: days(-2),
    expires_at: days(28),
    patient,
    notes: null,
    dispenses: [],
    ...extra,
  });
  const list = [
    base("open", {
      code: "482913",
      phone: "0911223344",
      notes: "Review in one week if the fever persists.",
      items: [
        item(0, "Amoxicillin 500 mg capsule", "500 mg", "Oral (PO)", "Every 8 hours", "7 days", "21 capsules"),
        item(1, "Oral Rehydration Salts 20.5 g", "1 sachet in 1 L water", "Oral (PO)", "After each loose stool", "3 days", "4 sachets"),
        item(2, "Paracetamol 500 mg tablet", "1 g", "Oral (PO)", "Every 6 hours as needed", "5 days", "as needed", "Not more than 4 g a day."),
      ],
    }),
    base("expired", {
      code: "135790",
      phone: "0922334455",
      written_at: days(-40),
      expires_at: days(-10),
      status: "expired",
      patient: { name: "Hirut Bekele", dedan_id: "ED-9A2B-77MN", age: 29, sex: "female" },
      items: [item(0, "Metformin 500 mg tablet", "500 mg", "Oral (PO)", "Twice daily", "30 days", "60 tablets")],
    }),
    base("completed", {
      code: "246802",
      phone: "0933445566",
      status: "completed",
      patient: { name: "Kebede Alemu", dedan_id: "ED-1C3D-55PQ", age: 61, sex: "male" },
      items: [
        { ...item(0, "Amlodipine 5 mg tablet", "5 mg", "Oral (PO)", "Once daily", "30 days", "30 tablets"), given_total: 30, status: "given" },
      ],
      dispenses: [{ at: days(-1), pharmacy_name: "Kenema Pharmacy", items: [{ item_index: 0, amount: 30, complete: false }] }],
    }),
    base("retracted", {
      code: "975310",
      phone: "0944556677",
      status: "retracted",
      patient: { name: "Selam Girma", dedan_id: "ED-6E8F-11RS", age: null, sex: null },
      items: [item(0, "Ciprofloxacin 500 mg tablet", "500 mg", "Oral (PO)", "Twice daily", "5 days", "10 tablets")],
    }),
    base("markup", {
      code: "111222",
      phone: "0955667788",
      hospital_name: "<b>Bold</b> Hospital",
      notes: '<img src=x onerror="window.__xss=1">',
      patient: { name: "<script>window.__xss=1</script>", dedan_id: "ED-0000-XSS1", age: 30, sex: "female" },
      items: [item(0, '<img src=x onerror="window.__xss=1">', "1", "Oral", "Once", "1 day", "1 tablet")],
    }),
  ];
  return new Map(list.map((rx) => [rx.rx_id, rx]));
}

let db, idem, failsByIp, failsByCode, tokenLookupsByIp, requests, slowNextDispenseMs;
function reset() {
  slowNextDispenseMs = 0;
  db = samples();
  idem = new Map();
  failsByIp = new Map();
  failsByCode = new Map();
  tokenLookupsByIp = new Map();
  requests = [];
}
reset();

// Sliding one-hour window counters.
function hits(map, key) {
  const now = Date.now();
  const list = (map.get(key) || []).filter((t) => now - t < HOUR);
  map.set(key, list);
  return list;
}

const normPhone = (p) => {
  const d = String(p ?? "").replace(/\D/g, "");
  if (d.startsWith("251") && d.length === 12) return `0${d.slice(3)}`;
  if (d.length === 9) return `0${d}`;
  return d;
};

function publicView(rx) {
  const { code: _c, phone: _p, ...rest } = rx;
  void _c;
  void _p;
  return structuredClone(rest);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

/** Resolves {token} or {code, phone}; returns rx, or a [status, body, headers] error. */
function resolve(body, ip) {
  if (typeof body.token === "string") {
    if (hits(tokenLookupsByIp, ip).length >= 60) return [429, { detail: "Too many requests" }, { "Retry-After": "3600" }];
    hits(tokenLookupsByIp, ip).push(Date.now());
    const [rxId, sig] = body.token.split(".");
    const rx = db.get(rxId);
    const expected = rxId ? sign(rxId) : "";
    if (!rx || !sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return [404, { detail: "Not found" }];
    }
    return rx;
  }
  if (typeof body.code === "string") {
    if (hits(failsByIp, ip).length >= 10 || hits(failsByCode, body.code).length >= 5) {
      return [429, { detail: "Too many requests" }, { "Retry-After": "3600" }];
    }
    const rx = [...db.values()].find((r) => r.code === body.code);
    if (!rx) {
      hits(failsByIp, ip).push(Date.now());
      hits(failsByCode, body.code).push(Date.now());
      return [404, { detail: "Not found" }];
    }
    if (body.phone !== undefined && body.phone !== null && String(body.phone).trim() !== "") {
      if (normPhone(rx.phone) !== normPhone(body.phone)) {
        hits(failsByIp, ip).push(Date.now());
        hits(failsByCode, body.code).push(Date.now());
        return [404, { detail: "Not found" }];
      }
    }
    return rx;
  }
  return [422, { detail: "token or code+phone required" }];
}

function dispense(rx, body) {
  if (rx.status !== "open") return [409, { detail: `Prescription is ${rx.status}`, status: rx.status }];
  const name = typeof body.pharmacy_name === "string" ? body.pharmacy_name.trim() : "";
  if (name.length < 2 || name.length > 120) return [422, { detail: "pharmacy_name must be 2-120 characters" }];
  if (!Array.isArray(body.items) || body.items.length === 0) return [422, { detail: "items required" }];

  // Validate everything first; apply all or nothing.
  for (const line of body.items) {
    const it = rx.items.find((i) => i.item_index === line.item_index);
    if (!it) return [422, { detail: `unknown item_index ${line.item_index}` }];
    if (line.amount != null && (typeof line.amount !== "number" || line.amount < 0)) return [422, { detail: "bad amount" }];
    if (it.status === "given") return [409, { detail: `item ${it.item_index} already given`, item_index: it.item_index }];
    if (line.amount != null && it.quantity_total != null) {
      const left = it.quantity_total - (it.given_total ?? 0);
      if (line.amount > left) return [409, { detail: `only ${left} left for item ${it.item_index}`, item_index: it.item_index }];
    }
  }
  for (const line of body.items) {
    const it = rx.items.find((i) => i.item_index === line.item_index);
    if (line.amount != null) it.given_total = (it.given_total ?? 0) + line.amount;
    if (line.complete || (it.quantity_total != null && it.given_total >= it.quantity_total)) it.status = "given";
    else if ((it.given_total ?? 0) > 0) it.status = "partly_given";
  }
  rx.dispenses.push({
    at: new Date().toISOString(),
    pharmacy_name: name,
    items: body.items.map((l) => ({ item_index: l.item_index, amount: l.amount ?? null, complete: !!l.complete })),
  });
  if (rx.items.every((i) => i.status === "given")) rx.status = "completed";
  return [200, publicView(rx)];
}

function readBody(req) {
  return new Promise((ok, bad) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 64 * 1024) bad(new Error("too large"));
    });
    req.on("end", () => ok(data));
    req.on("error", bad);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://mock");

  if (req.method === "POST" && url.pathname === "/__reset") {
    reset();
    return send(res, 200, { ok: true });
  }
  if (req.method === "GET" && url.pathname === "/__requests") return send(res, 200, requests);
  if (req.method === "POST" && url.pathname === "/__slow-next-dispense") {
    slowNextDispenseMs = Number(url.searchParams.get("ms") || 5000);
    return send(res, 200, { ok: true });
  }
  if (req.method === "GET" && url.pathname === "/__samples") {
    return send(
      res,
      200,
      [...db.values()].map((r) => ({ key: r.rx_id, status: r.status, token: tokenFor(r.rx_id), code: r.code, phone: r.phone })),
    );
  }

  if (req.method !== "POST" || !["/pharmacy/lookup", "/pharmacy/dispense"].includes(url.pathname)) {
    return send(res, 404, { detail: "Not found" });
  }

  const given = Buffer.from(String(req.headers["x-pharmacy-key"] ?? ""));
  const want = Buffer.from(API_KEY);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    return send(res, 401, { detail: "Invalid pharmacy key" });
  }

  let body;
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    return send(res, 400, { detail: "Invalid JSON" });
  }
  const ip = String(req.headers["x-client-ip"] ?? "unknown");
  const idemKey = req.headers["idempotency-key"];
  requests.push({
    path: url.pathname,
    clientIp: ip,
    idempotencyKey: idemKey ?? null,
    // The site must never pass nginx's edge key on.
    edgeKeyForwarded: req.headers["x-endod-edge-key"] !== undefined,
    body,
  });
  if (requests.length > 200) requests.shift();

  if (url.pathname === "/pharmacy/dispense") {
    if (!idemKey) return send(res, 422, { detail: "Idempotency-Key required" });
    if (idem.has(idemKey)) {
      const [s, b] = idem.get(idemKey);
      return send(res, s, b);
    }
  }

  const rx = resolve(body, ip);
  if (Array.isArray(rx)) return send(res, ...rx);

  if (url.pathname === "/pharmacy/lookup") return send(res, 200, publicView(rx));

  const result = dispense(rx, body);
  idem.set(idemKey, result);
  if (slowNextDispenseMs) {
    const ms = slowNextDispenseMs;
    slowNextDispenseMs = 0;
    setTimeout(() => {
      if (!res.destroyed) send(res, ...result);
    }, ms);
    return;
  }
  return send(res, ...result);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock Endod platform on http://127.0.0.1:${PORT}`);
  for (const r of db.values()) {
    console.log(
      `  ${r.status.padEnd(9)} /rx/${tokenFor(r.rx_id)}  code ${r.code} phone ${r.phone}`,
    );
  }
});
