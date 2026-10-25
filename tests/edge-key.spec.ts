import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { EDGE_SECRET, MOCK_URL, PROD_ORIGIN, PROD_PORT, PROD_URL, TEST_KEY } from "./env";

// Only our nginx may call the site: in production every request needs
// X-Endod-Edge-Key (= EDGE_SHARED_SECRET), except the container's own
// healthcheck (GET /api/health from 127.0.0.1 or ::1). PROD_URL is the
// production-mode server from playwright.config.ts; the "unset" tests start
// another one themselves.

const UNSET_PORT = Number(process.env.E2E_UNSET_PORT || 3013);
const key = { "X-Endod-Edge-Key": EDGE_SECRET };
const clientIp = { "X-Endod-Client-IP": "198.51.100.30" };

const get = (request: APIRequestContext, url: string, headers: Record<string, string> = {}) =>
  request.get(url, { headers, maxRedirects: 0, failOnStatusCode: false });

async function openToken(request: APIRequestContext): Promise<string> {
  await request.post(`${MOCK_URL}/__reset`);
  const list: { code: string; token: string }[] = await (await request.get(`${MOCK_URL}/__samples`)).json();
  return list.find((x) => x.code === "482913")!.token;
}

const lookup = (request: APIRequestContext, base: string, token: string, headers: Record<string, string>) =>
  request.post(`${base}/api/lookup`, {
    headers: { Origin: PROD_ORIGIN, "Content-Type": "application/json", ...clientIp, ...headers },
    data: { token },
    failOnStatusCode: false,
  });

/** This machine's first non-loopback IPv4 address: requests to it do not come from 127.0.0.1. */
function lanAddress(): string | undefined {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return undefined;
}

test("production: no key or a wrong key gets 403 on pages, API routes and assets", async ({ request }) => {
  const token = await openToken(request);
  const before = ((await (await request.get(`${MOCK_URL}/__requests`)).json()) as unknown[]).length;
  const cases: Record<string, string>[] = [
    {},
    { "X-Endod-Edge-Key": "wrong" },
    { "X-Endod-Edge-Key": `${EDGE_SECRET}x` },
    { "X-Endod-Edge-Key": EDGE_SECRET.slice(0, -1) },
  ];
  for (const headers of cases) {
    for (const url of ["/", `/rx/${token}`, "/rx/code", "/favicon.ico"]) {
      const res = await get(request, `${PROD_URL}${url}`, { ...clientIp, ...headers });
      expect(res.status(), `${url} ${JSON.stringify(headers)}`).toBe(403);
    }
    const res = await lookup(request, PROD_URL, token, headers);
    expect(res.status()).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden." });
  }
  // Nothing reached the platform.
  expect(((await (await request.get(`${MOCK_URL}/__requests`)).json()) as unknown[]).length).toBe(before);
});

test("production: with the key the site works, and the key is never passed on or echoed", async ({ request }) => {
  const token = await openToken(request);
  const page = await get(request, `${PROD_URL}/`, key);
  expect(page.status()).toBe(200);
  expect(await page.text()).not.toContain(EDGE_SECRET);
  expect(JSON.stringify(page.headers())).not.toContain(EDGE_SECRET);

  const res = await lookup(request, PROD_URL, token, key);
  expect(res.status()).toBe(200);
  expect(await res.text()).not.toContain(EDGE_SECRET);
  const sent = (await (await request.get(`${MOCK_URL}/__requests`)).json()) as {
    clientIp: string;
    edgeKeyForwarded: boolean;
  }[];
  expect(sent[sent.length - 1]).toMatchObject({ clientIp: "198.51.100.30", edgeKeyForwarded: false });
});

test("production: the localhost healthcheck needs no key; nothing else does", async ({ request }) => {
  const health = await get(request, `${PROD_URL}/api/health`);
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ ok: true });
  // A forged loopback marker changes nothing.
  expect((await get(request, `${PROD_URL}/api/health`, { "X-Endod-Loopback": "1" })).status()).toBe(200);
  expect((await get(request, `${PROD_URL}/`)).status()).toBe(403);
  expect((await request.post(`${PROD_URL}/api/health`, { failOnStatusCode: false })).status()).toBe(403);
});

test("production: from another address the health path needs the key too, whatever headers say", async ({ request }) => {
  const lan = lanAddress();
  test.skip(!lan, "no non-loopback network address on this machine");
  const url = `http://${lan}:${PROD_PORT}/api/health`;
  const forged = { "X-Forwarded-For": "127.0.0.1", "X-Real-IP": "127.0.0.1", "X-Endod-Loopback": "1", Host: `127.0.0.1:${PROD_PORT}` };
  expect((await get(request, url)).status()).toBe(403);
  expect((await get(request, url, forged)).status()).toBe(403);
  expect((await get(request, url, key)).status()).toBe(200);
});

test.describe("production without EDGE_SHARED_SECRET", () => {
  test.describe.configure({ mode: "serial" });
  let server: ChildProcess | undefined;
  const base = `http://127.0.0.1:${UNSET_PORT}`;

  async function start(secret: string) {
    server = spawn(process.execPath, [path.join(__dirname, "..", ".next", "standalone", "server.js")], {
      env: {
        ...process.env,
        PORT: String(UNSET_PORT),
        HOSTNAME: "127.0.0.1",
        PLATFORM_API_URL: MOCK_URL,
        PHARMACY_API_KEY: TEST_KEY,
        SITE_ORIGIN: PROD_ORIGIN,
        EDGE_SHARED_SECRET: secret,
      },
      stdio: "ignore",
    });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`${base}/api/health`)).status === 503) return;
      } catch {
        // not listening yet
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error("the unconfigured server did not come up");
  }

  async function stop() {
    const child = server;
    server = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  }

  test.afterAll(stop);

  test("every request gets 503 not configured, even the healthcheck", async ({ request }) => {
    test.setTimeout(90_000);
    await start("");
    const token = await openToken(request);
    for (const headers of [{}, key] as Record<string, string>[]) {
      for (const url of ["/api/health", "/", `/rx/${token}`]) {
        const res = await get(request, `${base}${url}`, headers);
        expect(res.status(), url).toBe(503);
      }
      const res = await lookup(request, base, token, headers);
      expect(res.status()).toBe(503);
      expect(await res.json()).toEqual({ error: "The pharmacy site is not configured. Contact Endod support." });
    }
    await stop();
  });

  test("a key shorter than 32 characters counts as unset", async ({ request }) => {
    test.setTimeout(90_000);
    await start("too-short-secret");
    const res = await get(request, `${base}/`, { "X-Endod-Edge-Key": "too-short-secret" });
    expect(res.status()).toBe(503);
    await stop();
  });
});
