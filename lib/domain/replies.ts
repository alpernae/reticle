// lib/replies.ts — reply-writer intelligence (client-safe: used by the API and to
// show ✓/✗ in the UI).
//
// Replies are conversation, not posts. Many high-engagement posts are GAMES with
// an explicit rule ("scare me with one word", "describe X in 3 emojis", "wrong
// answers only", "drop your …"). The replies that win — and get the author to
// reply back — play the game exactly, with a twist. So we detect the rule, put it
// in the prompt as a hard constraint, and check every reply against it.

export type ReplyConstraint = { label: string; maxWords?: number; exactWords?: number; emojiOnly?: boolean; maxEmoji?: number; wrongAnswers?: boolean; drop?: boolean };

const NUM: Record<string, number> = { one: 1, a: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

export function detectConstraint(post: string): ReplyConstraint | null {
  const t = post.toLowerCase().replace(/\s+/g, ' ');
  const n = (s: string) => NUM[s] ?? Number(s);
  let m = /\b(one|single|a|1)[- ]word\b/.exec(t) || /\bin (one|1) word\b/.exec(t);
  if (m) return { label: 'one word', exactWords: 1 };
  m = /\b(?:in |with )?(two|three|four|five|six|\d)[- ]words?\b/.exec(t);
  if (m && n(m[1]) <= 10) return { label: `${m[1]} words`, maxWords: n(m[1]) };
  m = /\b(?:in |with |using )?(one|two|three|four|five|\d)[- ]emojis?\b/.exec(t) || /\bemojis? only\b/.exec(t);
  if (m) return { label: m[1] ? `${m[1]} emoji${n(m[1]) > 1 ? 's' : ''}` : 'emoji only', emojiOnly: true, maxEmoji: m[1] ? n(m[1]) : 5 };
  if (/wrong answers only/.test(t)) return { label: 'wrong answers only', wrongAnswers: true };
  if (/\bdrop (your|ur|the)\b|\bshare (your|ur)\b|\bshow me your\b|\bwhat are you (building|working on)\b/.test(t)) return { label: 'drop / share yours', drop: true };
  return null;
}

const EMOJI = /\p{Extended_Pictographic}/gu;

/** Strip a leading "STYLE: …" line and check the reply against the constraint. */
export function checkReply(reply: string, c: ReplyConstraint | null): { style: string; text: string; ok: boolean | null; why: string } {
  const m = /^\s*STYLE\s*:\s*([^\n]+)\n+/i.exec(reply);
  const style = m ? m[1].trim() : '';
  const text = (m ? reply.slice(m[0].length) : reply).trim();
  if (!c) return { style, text, ok: null, why: '' };
  const words = text.replace(EMOJI, ' ').replace(/[^\p{L}\p{N}'’\-\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (c.exactWords) {
    const ok = words.length === c.exactWords;
    return { style, text, ok, why: ok ? `fits “${c.label}”` : `${words.length} words — breaks “${c.label}”` };
  }
  if (c.maxWords) {
    const ok = words.length > 0 && words.length <= c.maxWords;
    return { style, text, ok, why: ok ? `fits “${c.label}”` : `${words.length} words — breaks “${c.label}”` };
  }
  if (c.emojiOnly) {
    const em = (text.match(EMOJI) || []).length;
    const ok = words.length === 0 && em > 0 && em <= (c.maxEmoji || 5);
    return { style, text, ok, why: ok ? `fits “${c.label}”` : `breaks “${c.label}”` };
  }
  return { style, text, ok: null, why: `rule: ${c.label}` };
}

export const REPLY_GOALS: { value: string; label: string; prompt: string }[] = [
  { value: 'noticed', label: 'Get noticed by their audience', prompt: 'Goal: get likes and profile clicks from the AUTHOR’S audience — be the reply people screenshot or upvote.' },
  { value: 'author', label: 'Get the author to reply', prompt: 'Goal: make the AUTHOR want to reply back (their reply puts you in front of everyone). Be easy to answer, funny, or a little provocative toward their own words.' },
  { value: 'debate', label: 'Start a side conversation', prompt: 'Goal: spark a thread under your reply — a take others want to agree or argue with.' },
];

export function replyPrompt(platform: string, post: string, existing: string, goal: string): string {
  const c = detectConstraint(post);
  const g = REPLY_GOALS.find(x => x.value === goal) || REPLY_GOALS[0];
  return `You are writing replies to someone else's ${platform} post. Replies are CONVERSATION, not posts.

THEIR POST:
---
${post.slice(0, 2000)}
---
${existing.trim() ? `REPLIES ALREADY UNDER IT (don't repeat these ideas; notice what the author answered and why):\n---\n${existing.slice(0, 2500)}\n---\n` : ''}
STEP 1 — READ THE ROOM (do this silently): what is the post's game or ask, its tone (playful / serious / venting / bragging / asking for help), and what kind of reply would make the author and readers react?
${c ? `HARD RULE detected in the post: "${c.label}". EVERY reply must obey it exactly${c.exactWords ? ` — exactly ${c.exactWords} word${c.exactWords > 1 ? 's' : ''}, optionally followed by an emoji or punctuation, nothing else` : ''}${c.maxWords ? ` — at most ${c.maxWords} words` : ''}${c.emojiOnly ? ' — emojis only, no words' : ''}${c.wrongAnswers ? ' — deliberately wrong, funny answers' : ''}${c.drop ? ' — actually drop/share something real (use a [placeholder] for links you must fill in)' : ''}. Playing the game exactly IS the value here; explaining or lecturing breaks it.` : 'No explicit rule: match the post\'s length and energy — a playful short post gets a short witty reply, a thoughtful post gets a thoughtful one. Most great replies are under 120 characters.'}
${g.prompt}

STEP 2 — write 8 replies in the creator's voice, giving them a twist only THEY could give, drawn from the creator profile in your instructions (their field, what they build, their pillars — e.g. a one-word reply that only someone in their niche would write), mixed across these styles:
- play-along (obeys the game, the twist makes it land) — at least 4 of these if there is a game
- witty / relatable
- a short question to the author they can't resist answering
- value-add — ONLY if the post invites help or opinions
Never: flattery ("great post!"), self-promotion, links, hashtags, lecturing, more than 1 emoji, anything longer than the post itself unless it asks for detail.

OUTPUT: exactly 8 items separated by a line containing exactly ===ITEM===. Each item = first line "STYLE: <style name>", then the reply text only.`;
}
