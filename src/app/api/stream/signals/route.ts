import { getCurrentUser } from "@/lib/auth/session";
import { queryOne } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Server-sent events: emits the count of signals created since the connection opened, checked every
 * 15s. Signals themselves are produced once per ingestion cycle, so this is "near real-time" by design.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  let since = new Date();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: string) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      send("hello", "ok");
      const timer = setInterval(async () => {
        try {
          const r = await queryOne<{ n: number; latest: Date | null }>(
            "SELECT count(*)::int AS n, max(created_at) AS latest FROM signals WHERE created_at > $1 AND is_demo = $2",
            [since, env.demoMode],
          );
          if (r && r.n > 0 && r.latest) {
            since = new Date(r.latest);
            send("signals", String(r.n));
          } else send("ping", String(Date.now()));
        } catch {
          send("ping", "error");
        }
      }, 15_000);
      // Close after 10 minutes; EventSource reconnects automatically.
      const closer = setTimeout(() => {
        clearInterval(timer);
        controller.close();
      }, 10 * 60_000);
      req.signal.addEventListener("abort", () => {
        clearInterval(timer);
        clearTimeout(closer);
        try {
          controller.close();
        } catch {}
      });
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
