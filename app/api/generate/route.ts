import { NextResponse } from 'next/server';
import { PLATFORM_HINTS, topicSpikes, fallbackDraft, allPayload } from '@/lib/engine';
import { analyze, patternLibrary, patternTable, winners, winnerCard, type Analyzed } from '@/lib/patterns';
import { smartAI } from '@/lib/aichain';
import { tracked, RunCancelled } from '@/lib/activity';
import { fitToLimit } from '@/lib/enforce';
import { FORMATS_BY_PLATFORM, FORMAT_PLAYBOOK, type PlatformKey } from '@/lib/playbook';
import { fitScorer } from '@/lib/score';
import { findRecycled, recycledText } from '@/lib/recycle';

export const maxDuration = 300;

type Req = {
  platform?: string | null; topic?: string | null; postRef?: string | null; tone?: string | null;
  notes?: string | null; idea?: string | null; format?: string | null; mode?: 'generate' | 'ping'; model?: { providerID: string; id: string } | null;
};

const TONE_GUIDE: Record<string, string> = {
  professional: 'Professional — clean, credible, precise; measured confidence.',
  casual: 'Casual — like talking to a hacker friend; contractions, relaxed rhythm.',
  witty: 'Witty — dry humor and sharp one-liners; the joke serves the point.',
  educational: 'Educational — teaches one concrete thing; clear steps; newcomer-friendly.',
  bold: 'Bold / contrarian — a strong stance backed by specifics, not vibes.',
  inspirational: 'Inspirational — momentum and encouragement; ends on a line that makes people start.',
};

export async function POST(req: Request) {
  const body: Req = await req.json().catch(() => ({}));

  if (body.mode === 'ping') {
    const ping = await smartAI('Reply with exactly: READY', 90000);
    if (ping.out) return NextResponse.json({ mode: 'ping', ok: true, message: `AI working via ${ping.model?.providerID} · ${ping.model?.id} (${Math.round((ping.ms || 0) / 100) / 10}s)` });
    return NextResponse.json({ mode: 'ping', ok: false, message: ping.errors.join(' | ') || 'AI unavailable' });
  }

  const pinned = body.model?.providerID && body.model?.id ? body.model : null;
  const platformKey = body.platform && PLATFORM_HINTS[body.platform] ? body.platform : 'x';
  const fmts = FORMATS_BY_PLATFORM[platformKey as PlatformKey] || [];
  const formatKey = body.format && fmts.includes(body.format) ? body.format : fmts[0];
  const formatLabel = formatKey ? FORMAT_PLAYBOOK[formatKey].label : '';
  const title = `${PLATFORM_HINTS[platformKey].label}${formatLabel ? ' · ' + formatLabel : ''} — ${(body.idea || body.topic || 'your pillars').replace(/\s+/g, ' ').slice(0, 70)}`;
  try {
    const result = await tracked({ kind: 'generate', title, page: '/generate', platform: platformKey, input: body, model: pinned }, async run => {
    const platform = body.platform && PLATFORM_HINTS[body.platform] ? body.platform : 'x';
    const pf = PLATFORM_HINTS[platform];
    const info = allPayload();
    const rows = analyze(info.posts);
    const lib = patternLibrary(rows);
    const topicName = body.topic || '';
    const inTopic = (a: Analyzed) => !topicName || !!a.topics?.includes(topicName);
  
    // --- pick the winners the model studies: seed first, then same-platform, then niche cross-platform ---
    const picked: Analyzed[] = [];
    const add = (a?: Analyzed) => { if (a && !picked.some(p => p.id === a.id)) picked.push(a); };
    if (body.postRef) add(rows.find(r => r.id === body.postRef));
    for (const w of winners(rows.filter(inTopic), { platform, limit: 5 })) add(w);
    for (const w of winners(rows.filter(inTopic), { nicheOnly: true, limit: 8 })) if (picked.length < 7) add(w);
    if (picked.length < 3) for (const w of winners(rows, { limit: 6 })) if (picked.length < 6) add(w);
  
    const spike = topicName ? topicSpikes().find(t => t.name === topicName) : null;
    const own = info.manual.filter(m => m.eng > 0).slice(0, 3);
    const samePlat = rows.filter(r => r.source === platform).length;
    const recycled = recycledText(findRecycled(rows).filter(c => c.platform === platform || samePlat < 6), 4);
  
    const ctx = [
      `TARGET PLATFORM: ${pf.label}. Collected posts on it: ${samePlat}${samePlat < 6 ? ' (thin — lean on cross-platform winners and platform best practice, and say so)' : ''}.`,
      topicName ? `TOPIC FOCUS: ${topicName}${spike ? ` — ${spike.fresh} posts in last 48h (${spike.pct >= 0 ? '+' : ''}${spike.pct}% vs prior 48h)` : ''}.` : 'TOPIC: choose from the creator\'s pillars, whichever fits the winning patterns best.',
      body.idea ? `CREATOR'S OWN IDEA / RAW MATERIAL (build the posts around this):\n${body.idea.slice(0, 2500)}` : '',
      '',
      'WINNER CARDS (study these):',
      picked.length ? picked.map((a, i) => winnerCard(a, i)).join('\n\n') : '(no collected posts yet — rely on platform best practice and say so)',
      '',
      'PATTERN TABLE:',
      patternTable(lib, samePlat >= 6 ? platform : undefined),
      recycled ? `
  RECYCLED POSTS — creators re-post these near-identically and they keep working (evergreen formats worth a reusable version):
  ${recycled}` : '',
      own.length ? `\nTHE CREATOR'S OWN LOGGED RESULTS: ${own.map(w => `"${w.text.replace(/\s+/g, ' ').slice(0, 90)}" (${w.platform}, eng ${w.eng})`).join(' | ')}` : '',
    ].filter(s => s !== '').join('\n');
  
    const prompt = `${ctx}
  
  (Platform and format rules are in the PLAYBOOK section of your system prompt — follow them exactly.)
  TONE: ${TONE_GUIDE[body.tone || 'professional'] || TONE_GUIDE.professional}
  ${body.notes ? `CREATOR NOTES (follow closely): ${body.notes.slice(0, 800)}\n` : ''}
  TASK:
  1. In "### Pattern" write 3–5 short lines: which winner card(s) you are borrowing from (by #), the exact mechanics that made them outliers, and the evidence from the pattern table. Be honest when evidence is thin.
  2. Then write 3 DIFFERENT ${pf.label} ${formatLabel ? formatLabel.toLowerCase() + ' ' : ''}drafts for the creator (follow the FORMAT section of the playbook exactly), each borrowing a different winning structure, each on one of the creator's pillars (or the topic focus / idea above). Original wording — never reuse a source's sentences.
  3. If RECYCLED POSTS are present, make one variant an EVERGREEN post the creator can re-post every few weeks (name it "Evergreen").
  4. Every post must have a strong first line (the hook), follow the platform rules and limits, max 2 emojis, and leave [placeholders] for real details only the creator knows.
  5. CLARITY: if the idea is a product, repo, tool or project, every draft must make clear WHAT it is, WHO it's for and any PREREQUISITE from the idea (stack, platform, tool) within the first 3 lines, and keep the key specific facts (names, features, link). Rewrite the creator's CTA naturally instead of pasting it.
  
  OUTPUT FORMAT (strict):
  ### Pattern
  <lines>
  
  ### Variant 1: <structure name> (from #N)
  <full post text>
  Hashtags: <comma list or "none">
  Best time: <day/hour window from the data, or "no data">
  
  ### Variant 2: <structure name> (from #N)
  ...same...
  
  ### Variant 3: <structure name> (from #N)
  ...same...`;
  
    run.step(`Writing 3 drafts${pinned ? ` with ${pinned.providerID} · ${pinned.id}` : ' (auto provider)'}`);
    const { out, model, errors, ms } = await smartAI(prompt, 240000, pinned, run.signal, { platform, format: formatKey, role: 'generate' });
    run.via(model);
    run.step('Parsing & scoring drafts');
    const usedCards = picked.map(a => ({ id: a.id, source: a.source, author: a.author || null, outlier: a.outlier, hook: a.hookLine, link: a.link }));
  
    if (out) {
      const variants = parseVariants(out);
      const insight = (/###\s*Pattern\s*\n([\s\S]*?)(?=###\s*Variant|$)/i.exec(out)?.[1] || '').trim();
      if (variants.length) {
        // every draft must fit the platform limit as the platform counts it (hashtags included)
        const ctx = { platform, format: formatKey, role: 'generate' };
        const fitted = await Promise.all(variants.map(v => fitToLimit(v.text + (v.hashtags.length ? '\n\n' + v.hashtags.join(' ') : '') + (v.firstReplyLine ? '\n' + v.firstReplyLine : ''), platform, formatKey, { pinned, signal: run.signal, ctx, thread: formatKey === 'x-thread' || formatKey === 'th-chain' })));
        const n = fitted.filter(f => f.info.shortened).length;
        if (n) run.step(`Shortened ${n} draft${n > 1 ? 's' : ''} to fit ${fitted[0].info.limit} characters`);
        fitted.forEach((f, i) => {
          const tags = variants[i].hashtags.filter(h => f.text.includes(h));
          (variants[i] as any).text = tags.length ? f.text.replace(new RegExp('\\n*' + tags.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+') + '\\s*$'), '').trim() : f.text;
          (variants[i] as any).hashtags = tags;
          (variants[i] as any).length = f.info;
          (variants[i] as any).firstReply = f.info.firstReply;
        });
        const fit = fitScorer(rows, platform);
        for (const v of variants) (v as any).fit = fit(v.text + (v.hashtags.length ? '\n' + v.hashtags.join(' ') : ''));
        return ({ mode: 'ai', via: model, ms, platform: pf.label, topic: topicName || 'your pillars', variants, insight, winners: usedCards, ai: allPayload().lastAI });
      }
      return ({ mode: 'template', platform: pf.label, topic: topicName, variants: fallbackDraft(platform, { title: picked[0]?.title, topic: topicName }).variants, insight: out.slice(0, 1500), hint: 'AI answered but not in the expected format — raw answer shown as the pattern note.', winners: usedCards });
    }
    const fb = fallbackDraft(platform, { title: picked[0]?.title, topic: topicName });
    return ({
      mode: 'template', platform: pf.label, topic: topicName, variants: fb.variants, winners: usedCards,
      aiError: errors.join(' | ') || 'no AI provider enabled',
      hint: `No AI provider answered. Open Settings → AI providers: install/log in to the Claude CLI, add an Anthropic API key, or start OpenCode.`,
    });
    }, (o: any) => (o.mode === 'template' ? String(o.aiError || o.hint || 'fell back to a template') : null));
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ mode: 'template', variants: [], aiError: e instanceof RunCancelled ? 'cancelled' : String(e?.message || e) }, { status: e instanceof RunCancelled ? 499 : 500 });
  }
}

function parseVariants(out: string) {
  const parts = out.split(/###\s*Variant\s*\d+\s*:?/i).slice(1);
  const variants: { angle: string; text: string; hashtags: string[]; bestTime?: string; firstReplyLine?: string }[] = [];
  for (const raw of parts) {
    const m = raw.match(/^\s*:?\s*([^\n]+)\n/);
    const angle = (m ? m[1] : '').replace(/^:\s*/, '').trim() || 'angle';
    let text = raw.slice(m ? m[0].length : 0).trim();
    // pull a "FIRST REPLY: …" line out first (wherever the model put it) so it doesn't
    // break the Hashtags / Best time parsing; it's re-attached as the last line for fitToLimit
    let firstReplyLine = '';
    text = text.split('\n').filter(l => {
      if (!firstReplyLine && /^\s*[(\[]?\s*(?:first reply|first comment)\s*[)\]]?\s*[:\-—]/i.test(l)) { firstReplyLine = l.trim(); return false; }
      return true;
    }).join('\n').trim();
    let bestTime: string | undefined;
    const bt = text.match(/\n\s*Best time\s*:\s*(.+)\s*$/i);
    if (bt) { bestTime = bt[1].trim(); text = text.slice(0, bt.index).trim(); }
    const hm = text.match(/\n\s*(?:Hashtags?|Tags)\s*:\s*(.+)\s*$/i);
    let hashtags: string[] = [];
    if (hm) { hashtags = hm[1].split(/[,\s]+/).filter(t => t.startsWith('#')).slice(0, 10); text = text.slice(0, hm.index).trim(); }
    if (text.length > 30) variants.push({ angle, text: text.slice(0, 5000), hashtags, bestTime, firstReplyLine });
  }
  return variants;
}

