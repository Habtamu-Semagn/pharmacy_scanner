// Shared by playwright.config.ts and the specs.
export const SITE_PORT = Number(process.env.E2E_PORT || 3011);
export const MOCK_PORT = Number(process.env.E2E_MOCK_PORT || 8788);
export const TEST_KEY = "e2e-pharmacy-key-3f9c1d7a5b";
export const BASE_URL = `http://127.0.0.1:${SITE_PORT}`;
export const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
