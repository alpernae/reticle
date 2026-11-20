// app/api/ask/route.ts — HTTP adapter for "Ask Reticle" (the top-bar dock).
//
// The question is answered by a durable task (kind "ask"): the route enqueues
// it and waits for the worker. The answer and the matching posts come back
// unchanged.
import { NextResponse } from 'next/server';
import { runTaskAndReply } from '@/lib/http/task-shim';
import { route } from '@/lib/http/route';

export const maxDuration = 180;

/** POST { q, model? } → { answer, posts } — "Ask Reticle" (the top-bar dock).
 *  Finds the collected posts that match the question, then answers it from
 *  your data digest + those posts. Recorded on Activity. */
const handler_POST = async (req: Request) => {
  const b = await req.json().catch(() => ({} as any));
  const q = String(b.q || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (q.length < 3) return NextResponse.json({ error: 'Ask a question.' }, { status: 400 });
  return runTaskAndReply({
    kind: 'ask',
    input: { q, model: b.model || null },
    title: `Ask: ${q.slice(0, 80)}`,
    page: '/',
    trigger: 'api',
  }, 175_000);
}

export const POST = route(handler_POST);
