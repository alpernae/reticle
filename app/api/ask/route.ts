import { NextResponse } from 'next/server';
import { allPayload, analysisDigest, digestText } from '@/lib/engine';
import { analyze } from '@/lib/patterns';
import { smartAI } from '@/lib/aichain';
import { tracked, RunCancelled } from '@/lib/activity';

export const maxDuration = 180;

const STOP = new Set('a an the and or of to in on for with about what which who how why is are was were do does did my me i you your it this that best top most posts post show find give tell get me from at by be can should'.split(' '));

/** POST { q, model? } → { answer, posts } — "Ask Reticle" (the top-bar dock).
 *  Finds the collected posts that match the question, then answers it from
 *  your data digest + those posts. Recorded on Activity. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({} as any));
  const q = String(b.q || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (q.length < 3) return NextResponse.json({ error: 'Ask a question.' }, { status: 400 });
  const model = b.model?.providerID && b.model?.id ? b.model : null;

  // keyword match over collected posts, best breakouts first
  const words = q.toLowerCase().split(/[^a-z0-9#@+.]+/).filter(w => w.length > 2 && !STOP.has(w));
  const rows = analyze(allPayload().posts);
  const scored = rows.map(r => {
    const hay = `${r.title} ${r.body || ''} ${(r.topics || []).join(' ')} ${r.author || ''} ${r.source}`.toLowerCase();
    const hits = words.filter(w => hay.includes(w)).length;
    return { r, hits };
  }).filter(x => x.hits > 0).sort((a, b) => b.hits - a.hits || b.r.outlier - a.r.outlier);
  const posts = scored.slice(0, 6).map(({ r }) => ({
    id: r.id, title: (r.hookLine || r.title).slice(0, 140), source: r.source, author: r.author || null,
    outlier: Math.round(r.outlier * 10) / 10, likes: r.score, link: r.link,
  }));

  try {
    const out = await tracked({ kind: 'ask', title: `Ask: ${q.slice(0, 80)}`, page: '/', input: { question: q }, model }, async run => {
      run.step('Reading your data');
      const digest = digestText(analysisDigest());
      const examples = scored.slice(0, 8).map(({ r }, i) => `${i + 1}. [${r.source}, @${r.author || '?'}, ${r.outlier.toFixed(1)}× their normal, ${r.score} likes] ${(r.hookLine || r.title).slice(0, 200)}`).join('\n');
      run.step('Answering');
      const r = await smartAI([
        `QUESTION: ${q}`,
        `MY DATA DIGEST (only source of truth for numbers):\n${digest}`,
        examples ? `COLLECTED POSTS THAT MATCH THE QUESTION:\n${examples}` : 'No collected post matches the question words.',
        'Answer in at most 6 short lines, plain text, no markdown headings or bold. Be concrete and specific to me. Only cite numbers that appear above; if the data cannot answer, say so in one line and suggest what to collect.',
      ].join('\n\n'), 150_000, model, run.signal, { role: 'brief' });
      run.via(r.model);
      if (!r.out) throw new Error(r.errors.join(' | ') || 'no answer');
      return { answer: r.out.replace(/\*\*/g, '').trim(), posts };
    });
    return NextResponse.json(out);
  } catch (e: any) {
    if (e instanceof RunCancelled) return NextResponse.json({ error: 'cancelled', posts }, { status: 499 });
    return NextResponse.json({ error: String(e?.message || e), posts }, { status: 500 });
  }
}
