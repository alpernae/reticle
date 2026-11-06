import { NextResponse, connection } from 'next/server';
import { getStore } from '@/lib/db';
import { smartAI } from '@/lib/aichain';
import { tracked, RunCancelled } from '@/lib/activity';
import { AUDIENCES, QUICK_FORMATS, type Tracker } from '@/lib/formats';
import { allPayload } from '@/lib/engine';
import { analyze, winners } from '@/lib/patterns';
import { fitScorer } from '@/lib/score';

export const maxDuration = 200;

const readTrackers = (): Tracker[] => { try { const v = JSON.parse(getStore().getMeta('trackers') || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

/** GET — saved series trackers. */
export async function GET() {
  await connection(); // request-time: SQLite reads are sync, so without this Next prerenders & caches the response
  return NextResponse.json({ trackers: readTrackers() });
}

/** POST { action: 'save', trackers } | { action: 'polish', text, model? } | { action: 'quick', format, audience, platform, count, idea?, model? } */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const pinned = body?.model?.providerID && body?.model?.id ? body.model : null;

  if (body?.action === 'save') {
    const list = Array.isArray(body.trackers) ? body.trackers.slice(0, 20) : [];
    getStore().setMeta('trackers', JSON.stringify(list).slice(0, 400_000));
    return NextResponse.json({ trackers: readTrackers() });
  }

  if (body?.action === 'polish') {
    try {
      const result = await tracked({ kind: 'format-polish', title: 'Polish series post — ' + String(body.text || '').split('\n')[0].slice(0, 60), page: '/formats', platform: 'x', input: { text: body.text }, model: pinned }, async run => {
        const text = String(body.text || '').slice(0, 2000);
        run.step(`Asking ${pinned ? `${pinned.providerID} · ${pinned.id}` : 'the AI (auto provider)'}`);
    const r = await smartAI(`Here is the creator's daily series post:\n---\n${text}\n---\nImprove ONLY the free-text parts (e.g. focus, lesson, shipped, blocker lines) so they are specific, punchy and in the creator's voice, and add at most ONE short line (≤ 90 chars) right after the headline that gives readers a reason to follow the series.
    HARD RULES: keep the headline, every emoji label and EVERY number/amount exactly as written (including "$?" and 0). Do not add statistics. Do not name companies or bug bounty programs. Return only the final post text.`, 90000, pinned, run.signal, { platform: 'x', role: 'polish' });
        run.via(r.model);
        if (!r.out) return { error: r.errors.join(' | ') || 'AI unavailable' };
        const out = r.out.replace(/^```\w*\n?|```$/g, '').trim();
        // guard: every number in the original must survive
        const nums = (s: string) => (s.match(/\$?\d[\d,.]*|\$\?/g) || []).map(x => x.replace(/[,.]$/, ''));
        const missing = nums(text).filter(n => !out.includes(n));
        if (missing.length) return { error: `AI changed your numbers (${missing.slice(0, 4).join(', ')}) — kept your original.`, text };
        return { text: out, via: r.model };
      }, (o: any) => (o.error ? String(o.error) : null));
      return NextResponse.json(result, { status: (result as any).error ? 502 : 200 });
    } catch (e: any) {
      return NextResponse.json({ error: e instanceof RunCancelled ? 'cancelled' : String(e?.message || e) }, { status: e instanceof RunCancelled ? 499 : 500 });
    }
  }

  if (body?.action === 'quick') {
    try {
      const result = await tracked({ kind: 'format-quick', title: `Quick posts · ${(QUICK_FORMATS.find(x => x.key === body.format) || QUICK_FORMATS[0]).name} · ${body.count || 5}× ${body.platform || 'x'}`, page: '/formats', platform: String(body.platform || 'x'), input: body, model: pinned }, async run => {
        const f = QUICK_FORMATS.find(x => x.key === body.format) || QUICK_FORMATS[0];
        const aud = AUDIENCES.find(x => x.key === body.audience) || AUDIENCES[0];
        const count = Math.max(1, Math.min(10, Number(body.count) || 5));
        const platform = String(body.platform || 'x');
        // ground in real winners of the same shape when we have them
        const rows = analyze(allPayload().posts);
        const shape = rows.filter(r => r.words <= 30 && (f.key === 'poll' ? /\n\s*[-•]/.test(r.body || '') : f.key === 'convince' ? /convince me|change my mind/i.test(r.body || '') : r.hook === 'question' || r.hook === 'engagement-ask'));
        const ex = winners(shape, { limit: 5 }).map(w => `- "${(w.body || w.title).replace(/\s+/g, ' ').slice(0, 160)}" (${w.outlier}× vs creator's normal, @${w.author || '?'})`).join('\n');
        const prompt = `FORMAT: ${f.name}. ${f.brief}
    EXAMPLE OF THE SHAPE (do not reuse its wording): ${JSON.stringify(f.example)}
    AUDIENCE: ${aud.label}${aud.key === 'mix' ? ' — rotate across mobile developers, SaaS/startup founders and security researchers' : aud.key === 'bridge' ? ' — questions that connect security with building apps/SaaS (where the two worlds meet)' : ''}.
    PLATFORM: ${platform}. Keep each post short (under 220 characters unless the format needs a snippet).
    ${ex ? `SAME-SHAPE POSTS THAT WON IN THE DATA:\n${ex}\n` : ''}${body.idea ? `CREATOR'S ANGLE / CONTEXT: ${String(body.idea).slice(0, 600)}\n` : ''}
    TASK: Write ${count} different posts in this format for the creator. Each must be specific to the audience (name real tools, stacks, bug classes, platforms they use), answerable in one reply, and honest — no fake numbers, no rage bait, no follow-for-follow. Vary the topics.
    OUTPUT: the posts only, separated by a line containing exactly ===POST===`;
        run.step(`Asking ${pinned ? `${pinned.providerID} · ${pinned.id}` : 'the AI (auto provider)'}`);
    const r = await smartAI(prompt, 180000, pinned, run.signal, { platform, role: 'quick-' + f.key });
        run.via(r.model);
        if (!r.out) return { error: r.errors.join(' | ') || 'AI unavailable' };
        // ===POST=== can't collide with code; fall back to fence-aware '---' splitting for older answers
        const parts = r.out.includes('===POST===') ? r.out.split(/\n?\s*===POST===\s*\n?/) : splitOutsideFences(r.out);
        const posts = parts.map(s => s.replace(/^\s*(\d+[.)]|#\d+:?)\s*/, '').trim()).filter(s => s.length > 5).slice(0, count);
        const fit = fitScorer(rows, platform);
        return { posts, fits: posts.map(p => fit(p.replace(/```[\s\S]*?```/g, '').replace(/\n?\s*ANSWER\s*:[\s\S]*$/i, ''))), via: r.model, ms: r.ms, grounded: !!ex };
      }, (o: any) => (o.error ? String(o.error) : null));
      return NextResponse.json(result, { status: (result as any).error ? 502 : 200 });
    } catch (e: any) {
      return NextResponse.json({ error: e instanceof RunCancelled ? 'cancelled' : String(e?.message || e) }, { status: e instanceof RunCancelled ? 499 : 500 });
    }
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

/** Split on lines of '---' that are NOT inside a ``` fenced code block. */
function splitOutsideFences(s: string): string[] {
  const out: string[] = [];
  let cur: string[] = [], inFence = false;
  for (const line of s.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && /^\s*---+\s*$/.test(line)) { out.push(cur.join('\n')); cur = []; continue; }
    cur.push(line);
  }
  out.push(cur.join('\n'));
  return out;
}
