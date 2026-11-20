// app/api/tools/route.ts — HTTP adapter for the Toolkit use case.
//
// The work itself is a durable task (kind "tool"): the route enqueues it and
// waits for the worker to finish it. The response shape is unchanged.
import { runTaskAndReply } from '@/lib/http/task-shim';
import { route } from '@/lib/http/route';

export const maxDuration = 240;

const handler_POST = async (req: Request) => {
  const body = await req.json().catch(() => ({} as any));
  return runTaskAndReply({
    kind: 'tool',
    input: body,
    title: `Toolkit · ${String(body?.tool || 'tool')}`,
    page: '/toolkit',
    platform: String(body?.platform || ''),
    trigger: 'api',
  }, 225_000);
}

export const POST = route(handler_POST);
