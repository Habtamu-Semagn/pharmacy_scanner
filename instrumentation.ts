// Runs once when the server starts, before it handles requests.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Lets proxy.ts recognise the container's own healthcheck (lib/edge-peer.ts).
    const { markLoopbackRequests } = await import("./lib/edge-peer");
    markLoopbackRequests();
  }
}
