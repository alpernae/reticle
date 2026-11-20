// GET /api/events — the live event stream (ADR-004, phase 4e).
//
// One long-lived connection carries what changed: the activity summary the
// shell used to poll for. The server pushes only when the summary actually
// changed, and a ping every 15 s keeps proxies from closing the connection.
//
// The client keeps a slow poll as a safety net, so the app still works if
// the stream is blocked (some proxies do not pass SSE through).
import { connection } from 'next/server';
import { activitySummary } from '@/lib/application/activity';
import { route } from '@/lib/http/route';

/** How often the server looks for a change. */
const TICK_MS = 1_500;
/** How often a keepalive goes out when nothing changed. */
const PING_MS = 15_000;

const handler_GET = async (req: Request) => {
  await connection();
  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true; // the client is gone
        }
      };
      let last = '';
      let lastPing = Date.now();
      const tick = () => {
        if (closed) return;
        try {
          const s = activitySummary();
          const json = JSON.stringify(s);
          if (json !== last) {
            last = json;
            lastPing = Date.now();
            send('activity', s);
          } else if (Date.now() - lastPing > PING_MS) {
            lastPing = Date.now();
            send('ping', { at: Date.now() });
          }
        } catch { /* the DB is busy — the next tick tries again */ }
      };
      tick();
      timer = setInterval(tick, TICK_MS);
      const stop = () => {
        closed = true;
        if (timer) clearInterval(timer);
        timer = null;
        try { controller.close(); } catch { /* already closed */ }
      };
      req.signal.addEventListener('abort', stop);
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx must not buffer the stream
    },
  });
};

export const GET = route(handler_GET);
