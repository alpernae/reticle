import { NextResponse, connection } from 'next/server';
import { categorizeBatch, uncategorizedIds } from '@/lib/categorize';
import { tracked, RunCancelled } from '@/lib/activity';
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
  const model = body?.model?.providerID && body?.model?.id ? body.model : null;
  const left = uncategorizedIds().length;
  if (!left) return NextResponse.json({ done: 0, remaining: 0 });
  try {
    const r = await tracked({ kind: 'categorize', title: `Categorize posts with AI — batch of ${Math.min(40, left)} (${left} left)`, page: '/patterns', input: { left }, model }, async run => {
      run.step('Asking the AI to sort ' + Math.min(40, left) + ' posts');
      const out = await categorizeBatch(model, run.signal);
      run.via(out.via);
      return out;
    }, o => o.error || null);
    return NextResponse.json(r, { status: r.error ? 502 : 200 });
  } catch (e: any) {
    return NextResponse.json({ done: 0, remaining: left, error: e instanceof RunCancelled ? 'cancelled' : String(e?.message || e) }, { status: e instanceof RunCancelled ? 499 : 500 });
  }
}

export const GET = route(handler_GET);
export const POST = route(handler_POST);
