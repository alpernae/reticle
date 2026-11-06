// lib/tool-prompts.ts — server-side prompts for the platform toolkit.
// Each tool gets: platform rules + limits, the creator's data for THAT platform
// (top outlier winners, pattern lifts, real hashtag performance) and a strict
// output contract the route can parse.
import 'server-only';
import { allPayload } from './engine';
import { analyze, patternLibrary, patternTable, winners, winnerCard, type Analyzed } from './patterns';
import { PLATFORM_LIMITS, TOOLS, type ToolDef, type ToolPlatform } from './tools';
import { replyPrompt } from './replies';

const AUD: Record<string, string> = {
  mix: 'a mix of mobile developers, SaaS/startup founders and security researchers',
  security: 'security researchers and bug bounty hunters', mobile: 'mobile developers (iOS, Android, Flutter, React Native)',
  saas: 'SaaS and startup founders, indie hackers', bridge: 'builders who care about security — where security meets shipping apps',
};
// Platform style rules live in ONE place: lib/playbook.ts (layered system prompt).

export type Grounding = { text: string; postsOnPlatform: number; hashtags: { tag: string; n: number; medianOutlier: number }[] };

/** Data context for one platform. Falls back to all platforms when the platform is thin. */
export function grounding(platform: ToolPlatform): Grounding {
  const rows = analyze(allPayload().posts);
  const mine = rows.filter(r => r.source === platform);
  const thin = mine.length < 8;
  const pool = thin ? rows : mine;
  const wins = winners(pool, { limit: 4 });
  const tags = hashtagStats(mine.length ? mine : rows);
  const parts = [
    `DATA FOR ${platform.toUpperCase()}: ${mine.length} collected posts${thin ? ` — too few; examples below come from all platforms (${rows.length} posts), so lean on platform best practice and say when evidence is thin` : ''}.`,
    wins.length ? `TOP OUTLIER POSTS (structure to learn from, never copy):\n${wins.map((w, i) => winnerCard(w, i, 260)).join('\n')}` : '',
    `PATTERN LIFTS:\n${patternTable(patternLibrary(pool), thin ? undefined : platform, 8)}`,
    tags.length ? `HASHTAGS SEEN IN THE DATA (n posts · median outlier):\n${tags.slice(0, 20).map(t => `${t.tag} n${t.n} ${t.medianOutlier}×`).join(', ')}` : '',
  ];
  return { text: parts.filter(Boolean).join('\n\n'), postsOnPlatform: mine.length, hashtags: tags };
}

function hashtagStats(rows: Analyzed[]) {
  const m = new Map<string, number[]>();
  for (const r of rows) for (const t of r.hashtags || []) (m.get(t) || m.set(t, []).get(t)!).push(r.outlier);
  return [...m].filter(([, v]) => v.length >= 2).map(([tag, v]) => {
    const s = [...v].sort((a, b) => a - b);
    return { tag, n: v.length, medianOutlier: Math.round(s[s.length >> 1] * 100) / 100 };
  }).sort((a, b) => b.medianOutlier * Math.log2(b.n + 1) - a.medianOutlier * Math.log2(a.n + 1));
}

/** Appended to content-writing tasks: the reader must understand WHAT it is, WHO it's for and any prerequisite. */
const CLARITY = `CLARITY CHECK before you output — every draft must pass all of these, rewrite it if not:
✓ A reader who has never heard of it understands WHAT it is (e.g. "a collection of Agent Skills for Claude Code / Cursor / Codex"), not just a vague benefit.
✓ It says WHO it is for and any PREREQUISITE / limitation from the brief (e.g. "if you build on Supabase") so the wrong reader doesn't try it and fail.
✓ It keeps the 1–2 most important specific facts from the brief (names, features, the link) instead of replacing them with generic claims.
✓ The hook still follows a winning pattern — clarity goes in lines 1–3, not instead of the hook.`;

const ITEMS = (n: number, what: string) => `OUTPUT: exactly ${n} ${what}, separated by a line containing exactly ===ITEM===. No numbering, no preamble, no commentary.`;

export function buildToolPrompt(toolKey: string, platform: ToolPlatform, input: Record<string, string>): { tool: ToolDef; prompt: string } {
  const tool = TOOLS.find(t => t.key === toolKey);
  if (!tool) throw new Error('unknown tool');
  if (!tool.platforms.includes(platform)) throw new Error(`${tool.name} is not available for ${platform}`);
  const lim = PLATFORM_LIMITS[platform];
  const g = grounding(platform);
  const v = (k: string) => String(input[k] || '').trim().slice(0, 4000);
  const aud = AUD[v('audience') || 'mix'] || AUD.mix;
  const tone = v('tone') ? `TONE: ${v('tone')}.` : '';
  // platform style now comes from the layered system prompt (lib/playbook.ts); keep only the hard limits here
  const head = `PLATFORM: ${platform}. LIMITS: ${lim.note}.\n\n${g.text}\n\n`;
  let task = '';
  switch (tool.key) {
    case 'bio':
      task = platform === 'linkedin'
        ? `Write 3 LinkedIn profile options. Each = "HEADLINE: <≤ ${lim.bio} chars>" then "ABOUT:" with a 120–250 word About section (hook line, what I do, proof only from facts given, who it helps, CTA). Emphasis: ${v('focus') || 'my pillars'}. CTA/link: ${v('cta') || 'none given'}. ${tone}\n${ITEMS(3, 'options')}`
        : `Write 5 ${platform} bios, each ≤ ${lim.bio} characters INCLUDING emojis and line breaks. Formula: who I am → what followers get → proof or personality → CTA. Emphasis: ${v('focus') || 'my pillars'}. Link/CTA: ${v('cta') || 'none given'}. ${tone} No invented numbers.\n${ITEMS(5, 'bios')}`;
      break;
    case 'pinned':
      task = `Write 2 pinned "start here" posts for ${platform}: line 1 = who I am in one punchy line, then 3–5 lines of what followers get (content pillars as benefits), one line of real proof (ONLY from: ${v('proof') || 'nothing given — use a [placeholder]'}), end with a follow CTA. ${tone}\n${ITEMS(2, 'posts')}`;
      break;
    case 'ideas':
      task = `Give 10 content ideas for ${platform} for ${aud}${v('topic') ? ` around: ${v('topic')}` : ' across my pillars'}. Each idea on its own item as:\nFORMAT: <e.g. carousel / thread / reel / short / text post / video>\nHOOK: <the exact first line>\nANGLE: <one sentence>\nWHY: <which winner card # or pattern lift it borrows from, or "best practice" if data is thin>\n${ITEMS(10, 'ideas')}`;
      break;
    case 'hooks':
      task = `Write 10 hooks (first line / first 3 seconds) for ${platform} about: ${v('topic')}. Audience: ${aud}. Mix hook types — prefer the ones with lift > 1 in the pattern table; include at least 2 personal-story, 2 proof/result, 2 question, 2 contrarian. Each ≤ 110 chars.\n${ITEMS(10, 'hooks')}`;
      break;
    case 'caption':
      task = `Write 3 different ${platform === 'youtube' ? 'YouTube community posts' : platform === 'instagram' ? 'Instagram captions' : `${platform} posts`} about:\n---\n${v('topic')}\n---\nAudience: ${aud}. ${tone} CTA intention: ${v('cta') || 'pick the best one for the platform'} (rewrite it naturally, don't paste it). Respect the limits. Each borrows a different winning structure. Hashtags only where the platform style allows, at the end.\n${CLARITY}\n${ITEMS(3, 'posts')}`;
      break;
    case 'thread':
      task = `Write one ${platform === 'threads' ? 'Threads chain (the author replying to their own post)' : 'X thread'} of ${v('length') || '7'} posts about: ${v('topic')}. Audience: ${aud}. Post 1 = hook that promises a specific payoff (≤ 240 chars, no "🧵 thread" filler). Middle posts numbered "2/", "3/" … one concrete point each with a detail or example. Last post = summary + CTA (follow / reply / bookmark). Each post ≤ ${lim.post} chars. Separate posts with a blank line.\n${CLARITY}\nOUTPUT: the thread only.`;
      break;
    case 'yt-titles':
      task = `Write 10 YouTube title + thumbnail text pairs for a video about: ${v('topic')}. Audience: ${aud}. Titles ≤ 60 chars, searchable keyword early, clear payoff, no clickbait you can't deliver. Thumbnail text 2–4 words that ADDS tension (never repeats the title).\nEach item exactly:\nTITLE: <title>\nTHUMBNAIL: <2–4 words>\n${ITEMS(10, 'pairs')}`;
      break;
    case 'yt-description':
      task = `Write a YouTube description for "${v('title')}". First 2 lines: the value + main keyword (shown in search). Then a short paragraph. Then CHAPTERS as "0:00 Intro" lines derived ONLY from this outline (keep its timestamps if given, otherwise write [0:00] placeholders): ${v('outline') || '(none)'}. Then a LINKS block using only: ${v('links') || '(none — leave [link] placeholders)'}. Then 3 hashtags. Then "TAGS:" with 15 comma-separated search tags.\nOUTPUT: the description only.`;
      break;
    case 'script':
      task = `Write a ${v('length') || '35'}-second ${platform === 'instagram' ? 'Reel' : 'YouTube Short'} script about: ${v('topic')}. Audience: ${aud}. Format as a table-like list: "[0–2s] VO: … | ON-SCREEN: … | SHOT: …" then the beats, ending with a line that loops back to the start. Then "CAPTION:" with a 1–2 line caption and 3–5 hashtags.\nOUTPUT: the script only.`;
      break;
    case 'repurpose':
      task = `Repurpose this post into native ${platform} format (structure, length, hook, CTA all adapted — not a copy):\n---\n${v('source')}\n---\nWrite 2 versions.\n${ITEMS(2, 'versions')}`;
      break;
    case 'hashtags':
      task = `Build hashtag & keyword sets for a ${platform} post about: ${v('topic')}.
Sections exactly:
BROAD (3): large hashtags
MID (5): mid-size, niche-relevant
NICHE (5): small, specific — best reach per post
${platform === 'youtube' ? 'TAGS (15): YouTube search tags, comma-separated\n' : ''}KEYWORDS (8): words/phrases to put in the caption/title/description for search
RECOMMENDED SET: the exact line to paste (${platform === 'instagram' ? '5–8 tags' : platform === 'linkedin' ? '3–5 tags' : platform === 'x' ? '0–1 tag' : '3 hashtags above the title'})
Prefer hashtags from the data list with median outlier ≥ 1 when relevant, and mark them "(from your data)". Never invent usage numbers.
OUTPUT: the sections only.`;
      break;
    case 'replies':
      // replies are conversation: read the post's game first (lib/replies.ts)
      task = replyPrompt(platform, v('source'), v('existing'), v('goal'));
      break;
    case 'yt-thumbnail':
    case 'reel-cover':
    case 'post-image':
      task = `Suggest 6 short on-image texts for a ${tool.name.toLowerCase()} about: ${v('topic')}. Each item exactly:\nHEADLINE: <2–6 words, huge-text friendly>\nHIGHLIGHT: <one word from the headline to colour>\nSUB: <optional 3–8 word subline, or empty>\n${ITEMS(6, 'options')}`;
      break;
    case 'banner':
      task = `Suggest 5 profile banner texts for ${platform} for this creator. Focus: ${v('focus') || 'my pillars'}. Each item exactly:\nHEADLINE: <3–7 words>\nHIGHLIGHT: <one word to colour>\nSUB: <topics separated by " · ", ≤ 60 chars>\n${ITEMS(5, 'options')}`;
      break;
    case 'carousel':
      task = `Write one ${platform} carousel (6–9 slides) about: ${v('topic')}. Audience: ${aud}. Slide 1 = hook (≤ 8 words title + ≤ 12 word subtitle). Middle slides: one point each (title ≤ 7 words, body ≤ 30 words, concrete). Last slide: CTA (save/follow/comment).
OUTPUT: a JSON array only: [{"title":"...","body":"..."}, ...]`;
      break;
  }
  return { tool, prompt: head + 'TASK:\n' + task };
}
