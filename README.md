# Endod pharmacy site

`pharmacy.endod-health.com`: pharmacists scan the QR code on a patient's Endod
prescription (or enter the 6-digit SMS code plus the patient's phone number),
see the prescription and record what they give. The contract with the Endod
platform is in [docs/endod-api.md](docs/endod-api.md) (section 5 is this site).

- `/`: the QR scanner, plus code and phone entry.
- `/rx/<token>`: a prescription, opened from its QR (phone camera apps open it directly).
- `/rx/code`: a prescription found by code and phone. The code and phone stay in
  the tab's `sessionStorage` and never go in the URL.
- `POST /api/lookup` and `POST /api/dispense`: server routes that call the platform
  with the pharmacy key. Browsers only ever talk to these.
- `GET /api/health`: liveness probe.

## Running locally

```bash
npm ci
npm run dev:mock      # mock platform on :8787 + next dev on :3000
```

`dev:mock` starts `scripts/mock-platform.mjs` (an in-memory version of the
platform API with sample prescriptions) and points the site at it. It prints
the sample `/rx/<token>` links and codes on start. The open sample uses code
`482913` with phone `0911223344`; expired, completed and retracted samples are
included too. Pass Next options after `--`, e.g. `npm run dev:mock -- -p 3010`.

The camera needs HTTPS or `localhost`. On a phone over the LAN, use Upload QR or
the SMS code, or put the dev server behind HTTPS.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `PLATFORM_API_URL` | yes in production | Base URL of the platform's internal API, e.g. `http://endod-platform-api:8000` (the default). |
| `PHARMACY_API_KEY` | yes | Sent as `X-Pharmacy-Key`. Server-side only: it is read at request time, never bundled, and never sent to the browser. |
| `SITE_ORIGIN` | no | Comma-separated origins allowed to POST to the API routes. Defaults to the request's own origin (`X-Forwarded-Proto` + `Host`). Set it to `https://pharmacy.endod-health.com` in production. |
| `PORT`, `HOSTNAME` | no | Listen address of the standalone server (Docker sets `3000` and `0.0.0.0`). |

Do not prefix any of these with `NEXT_PUBLIC_`.

## Checks and tests

```bash
npx eslint .
npx tsc --noEmit
npm run build         # standalone output in .next/standalone
npm test              # Playwright, against the build and the mock platform
```

The tests use the installed Google Chrome (`channel: "chrome"`); no Playwright
browser download is needed. They start the mock on :8788 and the standalone
server on :3011 (`E2E_MOCK_PORT`, `E2E_PORT` to change). CI
(`.github/workflows/ci.yml`) runs lint, type check, build and the tests.

## Deploying

The image runs the Next.js standalone server as the non-root `node` user, with a
healthcheck on `/api/health`:

```bash
docker build -t endod-pharmacy .
docker run -d --name endod-pharmacy --restart unless-stopped \
  --network <platform bus network> \
  -e PLATFORM_API_URL=http://endod-platform-api:8000 \
  -e PHARMACY_API_KEY=... \
  -e SITE_ORIGIN=https://pharmacy.endod-health.com \
  -p 127.0.0.1:3000:3000 endod-pharmacy
```

It must be on the same Docker network as the platform's `internal-api`
(alias `endod-platform-api`). Behind nginx at `pharmacy.endod-health.com`:

```nginx
server {
  listen 443 ssl http2;
  server_name pharmacy.endod-health.com;
  # ssl_certificate ...; ssl_certificate_key ...;

  client_max_body_size 16k;
  add_header Strict-Transport-Security "max-age=31536000" always;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    # Overwrite, do not append: the site passes this IP to the platform for rate limits.
    proxy_set_header X-Forwarded-For $remote_addr;
    # Only keep this if Cloudflare is in front; otherwise clients could spoof it.
    proxy_set_header CF-Connecting-IP "";
  }
}

server {
  listen 80;
  server_name pharmacy.endod-health.com;
  return 301 https://$host$request_uri;
}
```

The client IP sent to the platform as `X-Client-IP` is taken from
`CF-Connecting-IP`, then the right-most `X-Forwarded-For` entry, then
`X-Real-IP`, falling back to `0.0.0.0`.

## Security notes

- The API routes accept only same-origin (`Origin` and `Sec-Fetch-Site`) JSON
  POSTs up to 8 KB, forward only the documented fields to the two fixed platform
  paths, and return only the documented response fields. Platform errors are
  mapped to fixed messages (404, 409, 429 and so on); platform calls time out
  after 10 s with "Endod is unreachable".
- Each dispense submission gets a fresh `Idempotency-Key` (UUID). Retries of the
  same submission after a network or server error reuse it, so a dispense is
  never recorded twice.
- Prescription text is rendered as text only. `Referrer-Policy: no-referrer`
  keeps `/rx/<token>` URLs out of `Referer` headers.
