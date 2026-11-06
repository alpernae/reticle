// lib/categorize.ts — Claude sorts posts the keyword rules couldn't place.
// Batches of 40 posts → one AI call → JSON of category keys per post. Only
// known keys are accepted; a post the model can't place gets ['life'] only if
// the model says so, otherwise stays uncategorized. Results live in posts.aiCats
// so they survive restarts and are never recomputed unless asked.
import 'server-only';
import { getStore } from './db';
import { allPayload } from './engine';
import { smartAI, type AIModelRef } from './aichain';
import { CATEGORIES, CATEGORY_KEYS, catsOf } from './categories';

const BATCH = 40;

export function uncategorizedIds(): string[] {
  return allPayload().posts.filter(p => !p.aiCats && catsOf(p).length === 0).map(p => p.id);
}

export async function categorizeBatch(model: AIModelRef | null = null, signal?: AbortSignal): Promise<{ done: number; remaining: number; error?: string; via?: AIModelRef | null }> {
  const posts = allPayload().posts.filter(p => !p.aiCats && catsOf(p).length === 0);
  const batch = posts.slice(0, BATCH);
  if (!batch.length) return { done: 0, remaining: 0 };
  const legend = CATEGORIES.filter(c => c.key !== 'none').map(c => `${c.key}: ${c.hint}`).join('\n');
  const lines = batch.map((p, i) => `${i} | @${p.author || '?'} | ${(p.body || p.text || p.title).replace(/\s+/g, ' ').slice(0, 280)}`).join('\n');
  const r = await smartAI(`Classify each social post into 1–2 categories (most specific first) from this list:
${legend}

POSTS (index | author | text):
${lines}

Rules: use only the keys above. A post about an AI tool used for coding → "ai-tools" (+ "dev" if it's about code). A founder sharing revenue → "saas". Personal/funny/off-topic → "life".
OUTPUT: a JSON array only, no prose: [{"i":0,"c":["key"]}, ...] — one object per post index.`, 120000, model, signal);
  if (!r.out) return { done: 0, remaining: posts.length, error: r.errors.join(' | ') || 'AI unavailable' };
  let arr: { i: number; c: string[] }[] = [];
  try { arr = JSON.parse(r.out.slice(r.out.indexOf('['), r.out.lastIndexOf(']') + 1)); } catch { return { done: 0, remaining: posts.length, error: 'AI answer was not valid JSON' }; }
  const store = getStore();
  let done = 0;
  for (const o of arr) {
    const p = batch[Number(o?.i)];
    if (!p) continue;
    const cats = (Array.isArray(o.c) ? o.c : []).map(String).filter(k => CATEGORY_KEYS.includes(k)).slice(0, 2);
    store.setAiCats(p.id, cats); // [] = model looked and found no fit (won't be re-asked)
    done++;
  }
  return { done, remaining: Math.max(0, posts.length - done), via: r.model };
}
