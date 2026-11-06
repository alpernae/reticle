import { NextResponse } from 'next/server';
import { analysisDigest, digestText, statsSummary, markAnalysis, markAI } from '@/lib/engine';
import { smartAI } from '@/lib/aichain';
import { tracked, RunCancelled } from '@/lib/activity';

export const maxDuration = 200;

/**
 * POST /api/analyze — the AI reads a SQL-backed digest of the whole database
 * (source mix, rising topics, top-engaged posts, posting-hour histogram, hook
 * patterns) and writes a short factual growth brief. Result is stored in the
 * meta table and re-served by /api/state until the next run. If every AI lane
 * is out of quota, a rules-based stats summary is stored instead (mode 'stats').
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const pinned = body?.model?.providerID && body?.model?.id ? body.model : null;
  const digest = analysisDigest();
  if (digest.total === 0) {
    return NextResponse.json({ mode: 'none', text: '', hint: 'No posts in the database yet — run a collector on Sources first.' });
  }

  const prompt = `DATA DIGEST (SQLite aggregates + outlier winners — the only source of truth, never invent numbers outside it):
${digestText(digest)}

TASK: Write a short, factual brief of AT MOST 170 words in exactly this shape:
1) 3 bullet insights — one names the strongest winning PATTERN (format/hook + its lift or outlier figure), one the topic or platform momentum, one a concrete timing or hook recommendation.
2) Last line starts with "Post this week:" — one post idea on the creator's pillars that borrows the strongest winner's structure (name the card #).
Rules: quote only figures present in the digest. Plain text + "· " bullets (markdown-free). No headings, no preamble.

OUTPUT FORMAT (strict):
· <insight>
· <insight>
· <insight>
Post this week: <idea>`;

  try {
    const result = await tracked({ kind: 'brief', title: `AI growth brief — ${digest.total} posts`, page: '/', input: { posts: digest.total }, model: pinned }, async run => {
      run.step(`Writing the brief${pinned ? ` with ${pinned.providerID} · ${pinned.id}` : ''}`);
      const { out, model, errors } = await smartAI(prompt, 180000, pinned, run.signal, { role: 'brief' });
      run.via(model);
      if (out) {
        const analysis = { mode: 'ai' as const, text: out.slice(0, 2000), ts: Date.now(), via: model ? { providerID: model.providerID, id: model.id } : null };
        markAnalysis(analysis);
        return { ...analysis, hint: '' };
      }
      if (!pinned) markAI(false, 'AI unavailable: ' + (errors.join(' | ') || 'all lanes failed')); // a pinned model failing isn't 'AI off'
      const analysis = { mode: 'stats' as const, text: statsSummary(digest), ts: Date.now(), via: null };
      markAnalysis(analysis);
      return { ...analysis, hint: 'AI not available — showing the rules-based stats summary.', aiError: errors.join(' | ') };
    }, (o: any) => (o.mode === 'stats' ? String(o.aiError || 'AI unavailable — stats summary only') : null));
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ mode: 'none', text: '', hint: e instanceof RunCancelled ? 'cancelled' : String(e?.message || e) }, { status: e instanceof RunCancelled ? 499 : 500 });
  }
}
