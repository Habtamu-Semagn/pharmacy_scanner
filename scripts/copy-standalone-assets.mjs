// After `next build`: the standalone server serves public/ and .next/static
// only when they sit next to it (see Next's `output: "standalone"` docs).
import { cpSync, existsSync } from "node:fs";

if (existsSync(".next/standalone")) {
  cpSync("public", ".next/standalone/public", { recursive: true });
  cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
}
