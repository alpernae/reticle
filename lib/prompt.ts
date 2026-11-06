// lib/prompt.ts — the system prompt for EVERY AI call (generate, analyze,
// studio agents), whichever provider answers. It carries the owner's creator
// profile (editable on Settings) so drafts sound like one consistent person.
import 'server-only';
import { getStore } from './db';
import { BRAND } from './brand';
import { FORMAT_PLAYBOOK, PLATFORM_PLAYBOOK, ROLE_PLAYBOOK, type PlatformKey, type PlaybookOverrides } from './playbook';

export type CreatorProfile = {
  name: string;          // how you sign / refer to yourself (optional)
  handle: string;        // @handle shown on generated images (optional)
  identity: string;      // who you are, in one or two lines
  pillars: string;       // content pillars, comma/newline separated
  audience: string;      // who you want to reach
  voice: string;         // how you sound
  goals: string;         // what growth means right now
  avoid: string;         // hard no's
};

// A neutral example, used only until you fill in Settings → Creator profile
// (your saved profile lives in your local SQLite and always wins over this).
export const DEFAULT_PROFILE: CreatorProfile = {
  name: '',
  handle: '',
  identity: 'A builder who shares what I learn while working on my own projects.',
  pillars: [
    'what I am building and why',
    'lessons and mistakes from the work',
    'tools and techniques I actually use',
    'practical tips for people a step behind me',
  ].join('; '),
  audience: 'people interested in the same field as me: practitioners, beginners who want to learn it, and peers building similar things.',
  voice: 'practical, direct and friendly; specific over generic; shows real process and mistakes; no guru tone',
  goals: 'grow followers and engagement on the platforms I post on, and build an audience that trusts what I share',
  avoid: 'fake numbers or results; confidential or private information; shaming specific people or companies; engagement bait; copying other creators verbatim',
};

export function readProfile(): CreatorProfile {
  try { return { ...DEFAULT_PROFILE, ...JSON.parse(getStore().getMeta('creatorProfile') || '{}') }; }
  catch { return { ...DEFAULT_PROFILE }; }
}
export function saveProfile(p: Partial<CreatorProfile>): CreatorProfile {
  const cur = readProfile();
  for (const k of Object.keys(DEFAULT_PROFILE) as (keyof CreatorProfile)[]) {
    if (typeof p[k] === 'string') cur[k] = String(p[k]).slice(0, 800);
  }
  getStore().setMeta('creatorProfile', JSON.stringify(cur));
  return cur;
}

// ---------------- playbook overrides (Settings → Playbook) ----------------
export function readPlaybookOverrides(): PlaybookOverrides {
  try { return JSON.parse(getStore().getMeta('playbook') || '{}'); } catch { return {}; }
}
export function savePlaybookOverride(kind: 'platforms' | 'formats' | 'roles' | 'voice', key: string, text: string | null): PlaybookOverrides {
  const o = readPlaybookOverrides();
  const bucket = { ...((o[kind] as Record<string, string>) || {}) };
  if (text == null || !text.trim()) delete bucket[key]; else bucket[key] = text.slice(0, 6000);
  (o as Record<string, unknown>)[kind] = bucket;
  getStore().setMeta('playbook', JSON.stringify(o));
  return o;
}

export type PromptCtx = { platform?: string | null; format?: string | null; role?: string | null };

/** The layered playbook block for one call: platform → voice → format → role (most specific last). */
export function playbookBlock(ctx: PromptCtx = {}): string {
  const o = readPlaybookOverrides();
  const parts: string[] = [];
  const pk = ctx.platform as PlatformKey | undefined;
  if (pk && PLATFORM_PLAYBOOK[pk]) {
    parts.push(o.platforms?.[pk] || PLATFORM_PLAYBOOK[pk].system);
    if (o.voice?.[pk]) parts.push(`CREATOR'S VOICE ON ${PLATFORM_PLAYBOOK[pk].label.toUpperCase()}: ${o.voice[pk]}`);
  }
  if (ctx.format && FORMAT_PLAYBOOK[ctx.format]) parts.push(o.formats?.[ctx.format] || FORMAT_PLAYBOOK[ctx.format].system);
  if (ctx.role && ROLE_PLAYBOOK[ctx.role]) parts.push(o.roles?.[ctx.role] || ROLE_PLAYBOOK[ctx.role].system);
  return parts.join('\n\n');
}

/** Base system prompt (creator + rules) + the playbook layers for this call. */
export function systemPrompt(ctx: PromptCtx = {}): string {
  const block = playbookBlock(ctx);
  return baseSystemPrompt() + (block ? `\n\n===== PLAYBOOK FOR THIS TASK (follow it; it overrides general habits) =====\n${block}` : '');
}

function baseSystemPrompt(): string {
  const p = readProfile();
  return `You are the strategist and ghost-writer inside ${BRAND.name}, a private content-intelligence dashboard for ONE creator.

THE CREATOR
- Who: ${p.identity}${p.name ? ` (name: ${p.name})` : ''}
- Content pillars: ${p.pillars}
- Audience to win: ${p.audience}
- Voice: ${p.voice}
- Goal: ${p.goals}
- Never: ${p.avoid}

HOW YOU WORK
1. You are given WINNER CARDS: real posts that beat their own creator's normal engagement (the OUTLIER × number). Large raw likes from huge accounts mean little; a high outlier score means the platform's algorithm pushed that post. Reverse-engineer WHY: hook mechanics, format, structure, length, pacing, CTA, timing.
2. You are given a PATTERN TABLE of traits that lift outlier scores per platform. Prefer patterns with lift > 1 and n ≥ 3; say when evidence is thin.
3. Transfer the winning STRUCTURE to the creator's own pillars and voice. Off-niche winners teach format, not topic. Never copy text verbatim and never impersonate the original author.
4. Ground every number in the supplied data. Never invent statistics, follower counts, bounty amounts, CVE ids or results. When the creator would need to supply a real detail (a payout, a bug class from their own report), leave a clear [placeholder].
5. Security content must be educational and responsible: no working exploits against real targets, no undisclosed vulnerabilities, no program names under NDA.
6. CLARITY CHECK — when the creator gives you an idea, product, repo or project, first extract (silently): WHAT it is (in plain words), WHO it is for, any PREREQUISITE or who it is NOT for (stack, platform, tool, skill level — e.g. "only useful if you build on Supabase"), the ONE main benefit, and the LINK if given. Every draft must make WHAT and WHO unmistakable, and must state the prerequisite when one exists, so the wrong reader doesn't try it and fail. A punchy hook is worthless if the reader can't tell what the thing is. Don't drop key facts the creator gave you in favour of a generic angle.
7. The creator's CTA is an intention, not a script: rewrite it naturally in the post's voice and grammar (e.g. "Give a try!" → "Try it on your next Supabase project — link below") instead of pasting it verbatim.

Write platform-native plain text that is ready to post (no markdown headings inside posts unless asked).`;
}

/** Legacy helper — prompt + system as one string (used by single-string providers). */
export function withSystem(prompt: string, ctx: PromptCtx = {}): string {
  return `${systemPrompt(ctx)}\n\n---\n\nTASK:\n${prompt}`;
}
