// lib/enforce.ts — make drafts fit the platform's real limit (server-side).
// The app counts (lib/limits.ts); when a draft is over, the model gets the exact
// count and how much to cut, up to 2 tries. A "first reply" link line is split
// out first so it neither counts against the post nor gets pasted into it.
import 'server-only';
import { smartAI, type AIModelRef } from './aichain';
import type { PromptCtx } from './prompt';
import { platformLength, postLimit, splitFirstReply, threadPosts } from './limits';

export type LengthInfo = { length: number; limit: number | null; over: boolean; shortened: number; firstReply: string };

async function shorten(text: string, platform: string, limit: number, pinned: AIModelRef | null, signal: AbortSignal | undefined, ctx: PromptCtx): Promise<{ text: string; tries: number }> {
  let cur = text, tries = 0;
  while (platformLength(platform, cur) > limit && tries < 2) {
    tries++;
    const n = platformLength(platform, cur);
    const r = await smartAI(`This ${platform} post is ${n} characters${platform === 'x' ? ' as X counts them (every link = 23, every emoji = 2)' : ''}. The hard limit is ${limit}. Cut at least ${n - limit + 12} characters.
Keep: the hook (line 1), what it is / who it is for / any prerequisite, the key specific facts, and the closing question or CTA. Cut filler words, merge lines, shorten phrasing. Do not add anything new.
POST:
---
${cur}
---
OUTPUT: only the shortened post, nothing else.`, 90000, pinned, signal, ctx);
    const next = (r.out || '').replace(/^```\w*\n?|\n?```$/g, '').replace(/^---\n?|\n?---$/g, '').trim();
    if (!next || platformLength(platform, next) >= n) break; // model failed to shorten — keep what we have
    cur = next;
  }
  return { text: cur, tries };
}

/** Fit ONE draft to the limit. Threads are checked post by post. */
export async function fitToLimit(text: string, platform: string, format: string | null | undefined, opts: { pinned: AIModelRef | null; signal?: AbortSignal; ctx: PromptCtx; thread?: boolean } ): Promise<{ text: string; info: LengthInfo }> {
  const { post, firstReply } = splitFirstReply(text);
  const limit = postLimit(platform, opts.thread ? 'x-post' : format);
  if (!limit) return { text: post, info: { length: platformLength(platform, post), limit: null, over: false, shortened: 0, firstReply } };
  if (opts.thread) {
    const posts = threadPosts(post);
    let shortened = 0;
    const fixed: string[] = [];
    for (const p of posts) {
      if (platformLength(platform, p) <= limit) { fixed.push(p); continue; }
      const s = await shorten(p, platform, limit, opts.pinned, opts.signal, opts.ctx);
      shortened += s.tries; fixed.push(s.text);
    }
    const longest = Math.max(...fixed.map(p => platformLength(platform, p)));
    return { text: fixed.join('\n\n'), info: { length: longest, limit, over: longest > limit, shortened, firstReply } };
  }
  if (platformLength(platform, post) <= limit) return { text: post, info: { length: platformLength(platform, post), limit, over: false, shortened: 0, firstReply } };
  const s = await shorten(post, platform, limit, opts.pinned, opts.signal, opts.ctx);
  const length = platformLength(platform, s.text);
  return { text: s.text, info: { length, limit, over: length > limit, shortened: s.tries, firstReply } };
}
