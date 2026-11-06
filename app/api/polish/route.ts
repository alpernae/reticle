import { NextResponse } from 'next/server';
import { smartAI } from '@/lib/aichain';
import { tracked, RunCancelled } from '@/lib/activity';
import { allPayload } from '@/lib/engine';
import { analyze, patternLibrary, patternTable, winners, winnerCard } from '@/lib/patterns';
import { fitScorer } from '@/lib/score';
import { PLATFORM_LIMITS } from '@/lib/tools';
import { fitToLimit } from '@/lib/enforce';

export const maxDuration = 200;

/**
 * POST /api/polish — revise ONE generated draft without re-running the whole generation.
 * { text, instruction, platform, format?, brief?, score?, model? }
 * → { text, changes[], fitBefore?, fitAfter?, runId }
 * Grounded: the creator's original brief is the only source of facts, and the
 * platform's pattern table + top winner structure keep the revision on a winning shape.
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({} as any));
  const text = String(b?.text || '').slice(0, 6000);
  const instruction = String(b?.instruction || '').slice(0, 2000).trim();
  const platform = String(b?.platform || 'x');
  const format = b?.format ? String(b.format) : null;
  const brief = String(b?.brief || '').slice(0, 4000).trim();
  const score = b?.score !== false;
  const pinned = b?.model?.providerID && b?.model?.id ? b.model : null;
  if (!text.trim() || !instruction) return NextResponse.json({ error: 'text and instruction are required' }, { status: 400 });

  try {
    const result = await tracked({
      kind: 'refine', title: `Polish · ${platform} — ${instruction.replace(/\s+/g, ' ').slice(0, 60)}`, page: '', platform,
      input: { instruction, text: text.slice(0, 1500), brief: brief.slice(0, 1500) }, model: pinned,
    }, async run => {
      const rows = analyze(allPayload().posts);
      const mine = rows.filter(r => r.source === platform);
      const pool = mine.length >= 8 ? mine : rows;
      const lim = (PLATFORM_LIMITS as Record<string, { post: number; note: string }>)[platform];
      const prompt = `You are revising ONE existing draft. Do NOT start over — keep what already works and change what the instruction asks.

${brief ? `THE CREATOR'S ORIGINAL BRIEF (the ONLY source of facts — names, features, links, prerequisites. Never add claims, numbers or features that aren't here):\n---\n${brief}\n---\n` : 'No brief was given: do not add any new facts, numbers or claims; only rephrase and restructure.\n'}
CURRENT DRAFT:
---
${text}
---

WHAT TO CHANGE: ${instruction}

STAY ON A WINNING SHAPE (evidence from collected ${pool === mine ? platform : 'all-platform'} posts):
${patternTable(patternLibrary(pool), pool === mine ? platform : undefined, 8)}
Structure reference (learn the shape, never copy words):
${winners(pool, { limit: 2 }).map((w, i) => winnerCard(w, i, 220)).join('\n')}

RULES:
- Apply the instruction fully. Keep the hook type, length and formatting that the pattern table favours unless the instruction says otherwise.
- Pass the clarity check: a reader must understand WHAT it is, WHO it's for and any prerequisite from the brief.
- Stay within the platform limit${lim ? ` (${lim.note})` : ''}. Keep [placeholders] for anything only the creator knows.
- If a link belongs in the first reply (X) or first comment (LinkedIn), do NOT leave it in the post: put it inside the REVISED section as its last line, exactly "FIRST REPLY: <short text + the link>".
- Don't make it sound more certain than the brief supports — no invented results, users, benchmarks or guarantees.

OUTPUT exactly:
===REVISED===
<the full revised draft, ready to post>
===CHANGES===
- <2–4 short bullets: what you changed and why>`;
      run.step(`Revising with ${pinned ? `${pinned.providerID} · ${pinned.id}` : 'the AI (auto provider)'}`);
      const r = await smartAI(prompt, 150000, pinned, run.signal, { platform, format, role: 'refine' });
      run.via(r.model);
      if (!r.out) return { error: r.errors.join(' | ') || 'AI unavailable' } as Record<string, unknown>;
      run.step('Checking the revision');
      const m = /===REVISED===\s*([\s\S]*?)\s*(?:===CHANGES===\s*([\s\S]*))?$/.exec(r.out);
      const revised = (m?.[1] || r.out).replace(/^```\w*\n?|\n?```$/g, '').trim();
      // the model's own length claims ("~270 chars") are unreliable — drop them, the app counts
      const changes = (m?.[2] || '').split('\n').map(s => s.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean)
        .filter(c => !/\b(\d+\s*char|characters?\b.*\d|under the limit|within the limit)/i.test(c)).slice(0, 5);
      const ctx = { platform, format, role: 'refine' };
      const fitted = await fitToLimit(revised, platform, format, { pinned, signal: run.signal, ctx, thread: format === 'x-thread' || format === 'th-chain' });
      if (fitted.info.shortened) { run.step(`Shortened to fit ${fitted.info.limit} characters`); changes.push(`Shortened to ${fitted.info.length}/${fitted.info.limit} characters (counted the way ${platform === 'x' ? 'X' : platform} counts).`); }
      if (fitted.info.firstReply) changes.push('Moved the link to a separate first reply (copy it after posting).');
      const fit = score ? fitScorer(rows, platform) : null;
      return { text: fitted.text, firstReply: fitted.info.firstReply, length: fitted.info, changes, fitBefore: fit ? fit(text) : undefined, fitAfter: fit ? fit(fitted.text) : undefined, via: r.model, ms: r.ms };
    }, (o: any) => (o.error ? String(o.error) : null));
    return NextResponse.json(result, { status: (result as any).error ? 502 : 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e instanceof RunCancelled ? 'cancelled' : String(e?.message || e) }, { status: e instanceof RunCancelled ? 499 : 500 });
  }
}
