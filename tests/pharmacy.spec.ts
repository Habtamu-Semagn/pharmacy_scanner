import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import QRCode from "qrcode";
import { tokenFromScan } from "../lib/rx";
import { BASE_URL, MOCK_URL, PROD_ORIGIN, PROD_URL, TEST_KEY, TEST_TIMEOUT_MS } from "./env";

interface Sample {
  key: string;
  status: string;
  token: string;
  code: string;
  phone: string;
}

let samples: Record<string, Sample>;

async function loadSamples(request: APIRequestContext) {
  await request.post(`${MOCK_URL}/__reset`);
  const list: Sample[] = await (await request.get(`${MOCK_URL}/__samples`)).json();
  // Sample keys in the mock are md5("mock-rx:<name>"); index by status + patient for clarity.
  const byStatus = (s: string) => list.filter((x) => x.status === s);
  samples = {
    open: list.find((x) => x.code === "482913")!,
    markup: list.find((x) => x.code === "111222")!,
    expired: byStatus("expired")[0],
    completed: byStatus("completed")[0],
    retracted: byStatus("retracted")[0],
  };
}

test.beforeEach(async ({ request, context }) => {
  // The layout loads Google Fonts; keep the tests independent of the internet
  // (a slow font server otherwise holds up the load event).
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  await loadSamples(request);
});

const sameOrigin = { Origin: BASE_URL, "Content-Type": "application/json" };

async function fillDispense(page: Page, amounts: Record<number, number>, fully: number[] = []) {
  for (const [idx, n] of Object.entries(amounts)) await page.locator(`#give-${idx}`).fill(String(n));
  for (const idx of fully) await page.locator(`#give-${idx}`).check();
}

async function confirmDispense(page: Page) {
  await page.getByRole("button", { name: "Review dispense" }).click();
  await expect(page.getByTestId("confirm-panel")).toBeVisible();
  await page.getByRole("button", { name: "Confirm dispense" }).click();
}

test("token lookup shows the real prescription", async ({ page }) => {
  await page.goto(`/rx/${samples.open.token}`);
  await expect(page.getByTestId("rx-hospital")).toHaveText("Felege Hiwot Comprehensive Specialized Hospital");
  await expect(page.getByTestId("rx-patient")).toHaveText("Abebe Tadesse Worku");
  await expect(page.getByText("Endod ID: ED-4F7K-92QX")).toBeVisible();
  await expect(page.getByText("42 yrs • male")).toBeVisible();
  await expect(page.getByText("Prescribed by Dr. Dawit Mengistu")).toBeVisible();
  await expect(page.getByTestId("rx-status")).toHaveText("Open");
  await expect(page.getByText("Amoxicillin 500 mg capsule")).toBeVisible();
  await expect(page.getByText("500 mg • Oral (PO) • Every 8 hours • 7 days")).toBeVisible();
  await expect(page.getByText("Qty: 21 capsules")).toBeVisible();
  await expect(page.getByTestId("progress-0")).toHaveText("Not given yet (0 of 21)");
  await expect(page.getByTestId("history-empty")).toBeVisible();
  // Unknown total: a "given fully" checkbox instead of an amount.
  await expect(page.locator("#give-2")).toHaveAttribute("type", "checkbox");
});

test("a bad or unknown token is refused", async ({ page }) => {
  await page.goto(`/rx/${samples.open.token.slice(0, -1)}X`);
  await expect(page.getByTestId("rx-error")).toContainText("No prescription found");
  await page.goto("/rx/not-a-token");
  await expect(page.getByTestId("rx-error")).toContainText("not a valid Endod prescription");
});

test("code + phone lookup, wrong phone is a 404", async ({ page }) => {
  await page.goto("/");
  await page.locator("#otp-input-field").fill(samples.open.code);
  await page.locator("#phone-input-field").fill("0911000000");
  await page.getByRole("button", { name: "Find Prescription" }).click();
  await expect(page.getByTestId("code-error")).toContainText("No prescription found");
  await expect(page).toHaveURL(`${BASE_URL}/`);

  await page.locator("#phone-input-field").fill("+251 911 223 344");
  await page.getByRole("button", { name: "Find Prescription" }).click();
  await expect(page).toHaveURL(`${BASE_URL}/rx/code`);
  await expect(page.getByTestId("rx-patient")).toHaveText("Abebe Tadesse Worku");
  expect(page.url()).not.toContain(samples.open.code);
  expect(page.url()).not.toContain("911");

  // A code lookup can dispense too (code + phone go to the API, not the URL).
  await page.locator("#pharmacy-name").fill("Kenema Pharmacy");
  await fillDispense(page, { 1: 2 });
  await confirmDispense(page);
  await expect(page.getByTestId("rx-success")).toBeVisible();
  await expect(page.getByTestId("progress-1")).toHaveText("2 of 4 given, 2 left");
});

test("partial dispense, then a second dispense completes it", async ({ page, request }) => {
  await page.goto(`/rx/${samples.open.token}`);
  await page.locator("#pharmacy-name").fill("Kenema Pharmacy");
  await page.locator("#pharmacist-name").fill("Sr. Meseret");
  await fillDispense(page, { 0: 7, 1: 4 });
  await page.getByRole("button", { name: "Review dispense" }).click();
  await expect(page.getByTestId("confirm-panel")).toContainText("give 7 (21 left)");
  await page.getByRole("button", { name: "Back" }).click();
  await confirmDispense(page);

  await expect(page.getByTestId("rx-success")).toBeVisible();
  await expect(page.getByTestId("progress-0")).toHaveText("7 of 21 given, 14 left");
  await expect(page.getByTestId("progress-1")).toHaveText("Given");
  await expect(page.locator("#give-1")).toHaveCount(0);
  await expect(page.getByTestId("history")).toContainText("Kenema Pharmacy");
  await expect(page.getByTestId("rx-status")).toHaveText("Open");

  // Pharmacy name is remembered on this device.
  await page.reload();
  await expect(page.locator("#pharmacy-name")).toHaveValue("Kenema Pharmacy");
  await fillDispense(page, { 0: 14 }, [2]);
  await confirmDispense(page);
  await expect(page.getByTestId("rx-status")).toHaveText("Completed");
  await expect(page.getByTestId("rx-closed")).toContainText("Everything on this prescription has been given");
  await expect(page.getByRole("button", { name: "Review dispense" })).toHaveCount(0);
  await expect(page.getByTestId("history").locator(":scope > li")).toHaveCount(2);

  const sent = (await (await request.get(`${MOCK_URL}/__requests`)).json()) as {
    path: string;
    idempotencyKey: string | null;
    clientIp: string;
    body: Record<string, unknown>;
  }[];
  const dispenses = sent.filter((r) => r.path === "/pharmacy/dispense");
  expect(dispenses).toHaveLength(2);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  expect(dispenses[0].idempotencyKey).toMatch(uuid);
  expect(dispenses[1].idempotencyKey).toMatch(uuid);
  expect(dispenses[0].idempotencyKey).not.toBe(dispenses[1].idempotencyKey);
  expect(dispenses[0].body).toEqual({
    token: samples.open.token,
    pharmacy_name: "Kenema Pharmacy",
    pharmacist_name: "Sr. Meseret",
    items: [
      { item_index: 0, amount: 7, complete: false },
      { item_index: 1, amount: 4, complete: false },
    ],
  });
  expect(dispenses[0].clientIp).toBeTruthy();
});

test("over-dispense is a 409 and the page refreshes", async ({ page, request }) => {
  await page.goto(`/rx/${samples.open.token}`);
  await expect(page.getByTestId("progress-0")).toHaveText("Not given yet (0 of 21)");

  // Another pharmacy gives 20 meanwhile.
  const other = await request.post("/api/dispense", {
    headers: { ...sameOrigin, "Idempotency-Key": crypto.randomUUID() },
    data: { token: samples.open.token, pharmacy_name: "Other Pharmacy", items: [{ item_index: 0, amount: 20, complete: false }] },
  });
  expect(other.status()).toBe(200);

  await page.locator("#pharmacy-name").fill("Kenema Pharmacy");
  await fillDispense(page, { 0: 5 });
  await confirmDispense(page);
  await expect(page.getByTestId("dispense-error")).toContainText("more than what is left");
  await expect(page.getByTestId("progress-0")).toHaveText("20 of 21 given, 1 left");

  // Directly against the API as well.
  const res = await request.post("/api/dispense", {
    headers: { ...sameOrigin, "Idempotency-Key": crypto.randomUUID() },
    data: { token: samples.open.token, pharmacy_name: "Kenema Pharmacy", items: [{ item_index: 0, amount: 2, complete: false }] },
  });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toContain("more than what is left");
});

test("the same Idempotency-Key never dispenses twice", async ({ request }) => {
  const key = crypto.randomUUID();
  const send = () =>
    request.post("/api/dispense", {
      headers: { ...sameOrigin, "Idempotency-Key": key },
      data: { token: samples.open.token, pharmacy_name: "Kenema Pharmacy", items: [{ item_index: 0, amount: 7, complete: false }] },
    });
  const a = await (await send()).json();
  const b = await (await send()).json();
  expect(a.prescription.items[0].given_total).toBe(7);
  expect(b.prescription.items[0].given_total).toBe(7);
  const missing = await request.post("/api/dispense", {
    headers: sameOrigin,
    data: { token: samples.open.token, pharmacy_name: "Kenema Pharmacy", items: [{ item_index: 0, amount: 1, complete: false }] },
  });
  expect(missing.status()).toBe(400);
});

test("expired, completed and retracted prescriptions are read-only", async ({ page, request }) => {
  await page.goto(`/rx/${samples.expired.token}`);
  await expect(page.getByTestId("rx-status")).toHaveText("Expired");
  await expect(page.getByTestId("rx-closed")).toContainText("expired");
  await expect(page.locator("#give-0")).toHaveCount(0);
  await expect(page.locator("#pharmacy-name")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review dispense" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Print prescription", exact: true })).toBeVisible();

  await page.goto(`/rx/${samples.retracted.token}`);
  await expect(page.getByTestId("rx-closed")).toContainText("withdrawn");
  await expect(page.locator("#give-0")).toHaveCount(0);

  await page.goto(`/rx/${samples.completed.token}`);
  await expect(page.getByTestId("rx-closed")).toContainText("has been given");
  await expect(page.getByTestId("history")).toContainText("Kenema Pharmacy");

  const res = await request.post("/api/dispense", {
    headers: { ...sameOrigin, "Idempotency-Key": crypto.randomUUID() },
    data: { token: samples.expired.token, pharmacy_name: "Kenema Pharmacy", items: [{ item_index: 0, amount: 1, complete: false }] },
  });
  expect(res.status()).toBe(409);
  expect(await res.json()).toEqual({
    error: "This prescription has expired and can no longer be dispensed.",
    status: "expired",
  });
});

test("scan decoding accepts only Endod prescription URLs", () => {
  const t = samples.open.token;
  expect(tokenFromScan(`https://pharmacy.endod-health.com/rx/${t}`)).toBe(t);
  expect(tokenFromScan(`http://localhost:3010/rx/${t}`, "http://localhost:3010")).toBe(t);
  expect(tokenFromScan(`http://pharmacy.endod-health.com/rx/${t}`)).toBeNull();
  expect(tokenFromScan(`https://pharmacy.endod-health.com.evil.io/rx/${t}`)).toBeNull();
  expect(tokenFromScan(`https://evil.io/rx/${t}`, "http://localhost:3010")).toBeNull();
  expect(tokenFromScan(`https://pharmacy.endod-health.com/rx/${t}/x`)).toBeNull();
  expect(tokenFromScan(`https://pharmacy.endod-health.com/rx/javascript:alert(1)`)).toBeNull();
  expect(tokenFromScan(t)).toBeNull();
  expect(tokenFromScan("482913")).toBeNull();
});

test("an uploaded non-Endod QR is refused; an Endod QR opens the prescription", async ({ page }) => {
  await page.goto("/");
  const foreign = await QRCode.toBuffer("https://example.com/rx/hello", { width: 300, margin: 4 });
  await page.getByTestId("qr-upload").setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: foreign });
  await expect(page.getByTestId("scan-error")).toContainText("Not an Endod prescription");
  await expect(page).toHaveURL(`${BASE_URL}/`);

  const endod = await QRCode.toBuffer(`https://pharmacy.endod-health.com/rx/${samples.open.token}`, { width: 300, margin: 4 });
  await page.getByTestId("qr-upload").setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: endod });
  await expect(page).toHaveURL(`${BASE_URL}/rx/${samples.open.token}`);
  await expect(page.getByTestId("rx-patient")).toHaveText("Abebe Tadesse Worku");
});

test("prescription text is shown as text, never as markup", async ({ page }) => {
  await page.goto(`/rx/${samples.markup.token}`);
  await expect(page.getByTestId("rx-patient")).toHaveText("<script>window.__xss=1</script>");
  await expect(page.getByTestId("rx-hospital")).toHaveText("<b>Bold</b> Hospital");
  await expect(page.getByText('<img src=x onerror="window.__xss=1">').first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test("API routes refuse cross-origin and non-JSON posts", async ({ request }) => {
  const body = { token: samples.open.token };
  const evil = await request.post("/api/lookup", {
    headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    data: body,
  });
  expect(evil.status()).toBe(403);

  const noOrigin = await request.post("/api/lookup", { headers: { "Content-Type": "application/json" }, data: body });
  expect(noOrigin.status()).toBe(403);

  const crossSite = await request.post("/api/dispense", {
    headers: { ...sameOrigin, "Sec-Fetch-Site": "cross-site", "Idempotency-Key": crypto.randomUUID() },
    data: { ...body, pharmacy_name: "X Pharmacy", items: [{ item_index: 0, amount: 1, complete: false }] },
  });
  expect(crossSite.status()).toBe(403);

  const form = await request.post("/api/lookup", {
    headers: { Origin: BASE_URL, "Content-Type": "text/plain" },
    data: JSON.stringify(body),
  });
  expect(form.status()).toBe(415);

  const big = await request.post("/api/lookup", {
    headers: sameOrigin,
    data: JSON.stringify({ token: samples.open.token, pad: "x".repeat(20_000) }),
  });
  expect(big.status()).toBe(413);

  // Only documented fields are forwarded; nothing else reaches the platform.
  const extra = await request.post("/api/lookup", {
    headers: sameOrigin,
    data: { code: "../../admin", phone: "x" },
  });
  expect(extra.status()).toBe(400);

  const get = await request.get("/api/lookup");
  expect(get.status()).toBe(405);
});

test("the platform key never reaches the browser", async ({ page, request }) => {
  const seen: string[] = [];
  page.on("response", async (res) => {
    try {
      seen.push(await res.text());
    } catch {
      /* redirects and the like have no body */
    }
  });
  await page.goto("/");
  await page.goto(`/rx/${samples.open.token}`);
  await expect(page.getByTestId("rx-patient")).toBeVisible();
  await page.goto("/rx/code");
  await page.waitForLoadState("networkidle");
  expect(seen.length).toBeGreaterThan(3);
  for (const text of seen) expect(text).not.toContain(TEST_KEY);

  const res = await request.post("/api/lookup", {
    headers: { ...sameOrigin, "X-Endod-Client-IP": "203.0.113.9" },
    data: { token: samples.open.token },
  });
  const text = await res.text();
  expect(text).not.toContain(TEST_KEY);
  expect(Object.values(res.headers()).join("\n")).not.toContain(TEST_KEY);
  expect(await lastClientIp(request)).toBe("203.0.113.9");

  // Platform errors are mapped, never passed through verbatim.
  const notFound = await request.post("/api/lookup", { headers: sameOrigin, data: { code: "000000", phone: "0911223344" } });
  expect(notFound.status()).toBe(404);
  expect(Object.keys(await notFound.json())).toEqual(["error"]);
});

async function lastClientIp(request: APIRequestContext): Promise<string> {
  const sent = (await (await request.get(`${MOCK_URL}/__requests`)).json()) as { clientIp: string }[];
  return sent[sent.length - 1].clientIp;
}

test("client IP comes only from X-Endod-Client-IP (dev falls back to 127.0.0.1)", async ({ request }) => {
  const lookupWith = (headers: Record<string, string>) =>
    request.post("/api/lookup", { headers: { ...sameOrigin, ...headers }, data: { token: samples.open.token } });

  // Spoofable headers are ignored entirely.
  const spoofed = await lookupWith({
    "CF-Connecting-IP": "198.51.100.7",
    "X-Forwarded-For": "198.51.100.8",
    "X-Real-IP": "198.51.100.9",
  });
  expect(spoofed.status()).toBe(200);
  expect(await lastClientIp(request)).toBe("127.0.0.1");

  expect((await lookupWith({ "X-Endod-Client-IP": "2001:db8::7" })).status()).toBe(200);
  expect(await lastClientIp(request)).toBe("2001:db8::7");

  expect((await lookupWith({ "X-Endod-Client-IP": "not-an-ip" })).status()).toBe(200);
  expect(await lastClientIp(request)).toBe("127.0.0.1");
});

test("production refuses requests without a valid X-Endod-Client-IP", async ({ request }) => {
  const before = ((await (await request.get(`${MOCK_URL}/__requests`)).json()) as unknown[]).length;
  const lookupWith = (headers: Record<string, string>) =>
    request.post(`${PROD_URL}/api/lookup`, {
      headers: { Origin: PROD_ORIGIN, "Content-Type": "application/json", ...headers },
      data: { token: samples.open.token },
    });

  const cases: Record<string, string>[] = [
    {},
    { "CF-Connecting-IP": "198.51.100.7", "X-Forwarded-For": "198.51.100.8", "X-Real-IP": "198.51.100.9" },
    { "X-Endod-Client-IP": "1.2.3.999" },
    { "X-Endod-Client-IP": "198.51.100.7, 198.51.100.8" },
  ];
  for (const headers of cases) {
    const res = await lookupWith(headers);
    expect(res.status()).toBe(503);
    expect(await res.json()).toEqual({ error: "The pharmacy site is not configured. Contact Endod support." });
  }
  const dispense = await request.post(`${PROD_URL}/api/dispense`, {
    headers: { Origin: PROD_ORIGIN, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    data: { token: samples.open.token, pharmacy_name: "Kenema Pharmacy", items: [{ item_index: 0, amount: 1, complete: false }] },
  });
  expect(dispense.status()).toBe(503);
  // None of those reached the platform.
  expect(((await (await request.get(`${MOCK_URL}/__requests`)).json()) as unknown[]).length).toBe(before);

  const ok = await lookupWith({ "X-Endod-Client-IP": "198.51.100.20" });
  expect(ok.status()).toBe(200);
  expect(await lastClientIp(request)).toBe("198.51.100.20");
});

test("a timed-out dispense retried after Back is recorded once", async ({ page, request }) => {
  await page.goto(`/rx/${samples.open.token}`);
  await page.locator("#pharmacy-name").fill("Kenema Pharmacy");
  await fillDispense(page, { 0: 7 });

  // The platform records it but answers too late: the site reports a timeout.
  await request.post(`${MOCK_URL}/__slow-next-dispense?ms=${TEST_TIMEOUT_MS + 2000}`);
  await confirmDispense(page);
  await expect(page.getByTestId("dispense-error")).toContainText("Endod is unreachable");
  await expect(page.getByTestId("dispense-error")).toContainText("may already have been recorded");

  // Back, edit and undo, Review, Confirm with the same lines: same key.
  await page.getByRole("button", { name: "Back" }).click();
  await page.locator("#give-0").fill("8");
  await page.locator("#give-0").fill("7");
  await confirmDispense(page);
  await expect(page.getByTestId("rx-success")).toBeVisible();
  await expect(page.getByTestId("progress-0")).toHaveText("7 of 21 given, 14 left");
  await expect(page.getByTestId("history").locator(":scope > li")).toHaveCount(1);

  const sent = ((await (await request.get(`${MOCK_URL}/__requests`)).json()) as {
    path: string;
    idempotencyKey: string;
  }[]).filter((r) => r.path === "/pharmacy/dispense");
  expect(sent).toHaveLength(2);
  expect(sent[1].idempotencyKey).toBe(sent[0].idempotencyKey);

  // A different submission afterwards gets a fresh key.
  await fillDispense(page, { 0: 1 });
  await confirmDispense(page);
  await expect(page.getByTestId("progress-0")).toHaveText("8 of 21 given, 13 left");
  const after = ((await (await request.get(`${MOCK_URL}/__requests`)).json()) as {
    path: string;
    idempotencyKey: string;
  }[]).filter((r) => r.path === "/pharmacy/dispense");
  expect(after[2].idempotencyKey).not.toBe(sent[0].idempotencyKey);
});

test("/patient redirects to the scanner", async ({ page }) => {
  await page.goto("/patient");
  await expect(page).toHaveURL(`${BASE_URL}/`);
});
