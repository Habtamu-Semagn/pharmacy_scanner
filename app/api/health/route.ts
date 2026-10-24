// Liveness probe for Docker/nginx. Does not call the platform.
export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
