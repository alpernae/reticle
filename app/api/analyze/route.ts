// app/api/analyze/route.ts — HTTP adapter for the Overview growth brief.
//
// The brief is a durable task (kind "brief"): the route enqueues it and waits
// for the worker. The result is stored in the meta table and re-served by
// /api/state until the next run.
import { runTaskAndReply } from '@/lib/http/task-shim';
import { route } from '@/lib/http/route';

export const maxDuration = 200;

/**
 * POST /api/analyze — the AI reads a SQL-backed digest of the whole database
 * (source mix, rising topics, top-engaged posts, posting-hour histogram, hook
 * patterns) and writes a short factual growth brief. If every AI lane is out
 * of quota, a rules-based stats summary is stored instead (mode 'stats').
 */
const handler_POST = async (req: Request) => {
  const body = await req.json().catch(() => ({} as any));
  return runTaskAndReply({
    kind: 'brief',
    input: { model: body?.model || null },
    title: 'AI growth brief',
    page: '/',
    trigger: 'api',
  }, 190_000);
}

export const POST = route(handler_POST);
