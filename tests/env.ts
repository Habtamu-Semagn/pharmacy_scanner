// Shared by playwright.config.ts and the specs.
export const SITE_PORT = Number(process.env.E2E_PORT || 3011);
export const MOCK_PORT = Number(process.env.E2E_MOCK_PORT || 8788);
export const TEST_KEY = "e2e-pharmacy-key-3f9c1d7a5b";
export const BASE_URL = `http://127.0.0.1:${SITE_PORT}`;
export const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
// A second server in production mode (https SITE_ORIGIN), for the client-IP rules.
export const PROD_PORT = Number(process.env.E2E_PROD_PORT || 3012);
export const PROD_URL = `http://127.0.0.1:${PROD_PORT}`;
export const PROD_ORIGIN = "https://pharmacy.endod-health.com";
// nginx's X-Endod-Edge-Key for the production-mode server (EDGE_SHARED_SECRET).
export const EDGE_SECRET = "e2e-edge-secret-0123456789abcdefghijklmnop";
// The site gives up on the platform after this long in the tests (10 s in production).
export const TEST_TIMEOUT_MS = 1500;
