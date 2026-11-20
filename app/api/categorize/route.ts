// app/api/categorize/route.ts — HTTP adapter for the AI categorizer.
//
// POST is a durable task (kind "categorize"): the route enqueues it and waits
// for the worker to sort one batch of 40 posts. The client loops until
// remaining = 0.
import { NextResponse, connection } from 'next/server';
import { uncategorizedIds } from '@/lib/categorize';
import { runTaskAndReply } from '@/lib/http/task-shim';
import { route } from '@/lib/http/route';

export const maxDuration = 200;

/** GET — how many posts still need AI categorization. */
const handler_GET = async () => {
  await connection(); // request-time: SQLite reads are sync, so without this Next prerenders & caches the response
  return NextResponse.json({ remaining: uncategorizedIds().length });
}

/** POST { model? } — categorize ONE batch (40 posts); the client loops until remaining = 0. */
const handler_POST = async (req: Request) => {
  const body = await req.json().catch(() => ({} as any));
  return runTaskAndReply({
    kind: 'categorize',
    input: { model: body?.model || null },
    title: `Categorize posts with AI — batch of ${Math.min(40, uncategorizedIds().length)} (${uncategorizedIds().length} left)`,
    page: '/patterns',
    trigger: 'api',
  }, 190_000);
}

export const GET = route(handler_GET);
export const POST = route(handler_POST);
