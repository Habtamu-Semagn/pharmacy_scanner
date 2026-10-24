#!/usr/bin/env node
// `npm run dev:mock`: the mock platform plus `next dev`, wired together.
// Extra arguments go to `next dev` (e.g. `npm run dev:mock -- -p 3010`).

import { spawn } from "node:child_process";

const mockPort = process.env.MOCK_PLATFORM_PORT || "8787";
const env = {
  ...process.env,
  MOCK_PLATFORM_PORT: mockPort,
  PHARMACY_API_KEY: process.env.PHARMACY_API_KEY || "dev-pharmacy-key",
  PLATFORM_API_URL: `http://127.0.0.1:${mockPort}`,
};

const children = [
  spawn(process.execPath, ["scripts/mock-platform.mjs"], { env, stdio: "inherit" }),
  spawn("npx", ["next", "dev", ...process.argv.slice(2)], { env, stdio: "inherit", shell: process.platform === "win32" }),
];

const stop = (code = 0) => {
  for (const c of children) if (c.exitCode === null) c.kill();
  process.exit(code);
};
for (const c of children) c.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
