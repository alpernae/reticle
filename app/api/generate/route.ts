// app/api/generate/route.ts — HTTP adapter for the drafts use case.
//
// The work itself is a durable task (kind "generate"): the route enqueues it
// and waits for the worker to finish it. The response shape is unchanged, so
// the Generate page needs no changes — but the result now belongs to the task
// table and survives the page being closed (ADR-001).
import { runTaskAndReply } from '@/lib/http/task-shim';
import { route } from '@/lib/http/route';

export const maxDuration = 300;

const handler_POST = async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const platform = String(body?.platform || 'x');
  return runTaskAndReply({
    kind: 'generate',
    input: body,
    title: `Generate · ${platform}`,
    page: '/generate',
    platform,
    trigger: 'api',
  }, 285_000);
}

export const POST = route(handler_POST);
