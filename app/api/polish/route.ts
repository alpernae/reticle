// app/api/polish/route.ts — HTTP adapter for the draft polisher.
//
// POST { text, instruction, platform, format?, brief?, score?, model? }
// → { text, changes[], fitBefore?, fitAfter?, runId }
//
// The revision is a durable task (kind "refine"): the route enqueues it and
// waits for the worker. Grounded: the creator's original brief is the only
// source of facts, and the platform's pattern table + top winner structure
// keep the revision on a winning shape.
import { NextResponse } from 'next/server';
import { runTaskAndReply } from '@/lib/http/task-shim';
import { route } from '@/lib/http/route';

export const maxDuration = 200;

const handler_POST = async (req: Request) => {
  const b = await req.json().catch(() => ({} as any));
  const text = String(b?.text || '').slice(0, 6000);
  const instruction = String(b?.instruction || '').slice(0, 2000).trim();
  if (!text.trim() || !instruction) return NextResponse.json({ error: 'text and instruction are required' }, { status: 400 });

  const platform = String(b?.platform || 'x');
  return runTaskAndReply({
    kind: 'refine',
    input: {
      text, instruction, platform,
      format: b?.format ? String(b.format) : null,
      brief: String(b?.brief || '').slice(0, 4000),
      score: b?.score !== false,
      model: b?.model || null,
    },
    title: `Polish · ${platform} — ${instruction.replace(/\s+/g, ' ').slice(0, 60)}`,
    page: '',
    platform,
    trigger: 'api',
  }, 190_000);
}

export const POST = route(handler_POST);
