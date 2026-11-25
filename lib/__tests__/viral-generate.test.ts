import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The AI never runs in a test — but the prompt it would have received is
// captured, so the wiring can be checked: the inspiration brief travels, the
// original wording never does.
const { prompts } = vi.hoisted(() => ({ prompts: [] as string[] }));

vi.mock('../aichain', () => ({
  smartAI: async (prompt: string) => {
    prompts.push(prompt);
    return {
      out: [
        '### Pattern',
        'Borrowed the opening shape, not the words.',
        '',
        '### Variant 1: short claim (from #1)',
        'A brand new post about my own thing, written by me today.',
        '',
        'Hashtags: none',
        '',
        '### Variant 2: short claim (from #1)',
        'Another brand new post, also mine, with enough words to count.',
        '',
        'Hashtags: none',
        '',
        '### Variant 3: short claim (from #1)',
        'A third brand new post, mine as well, with words that are enough.',
        '',
        'Hashtags: none',
      ].join('\n'),
      model: { providerID: 'test', id: 'test-model' },
      errors: [],
      ms: 12,
    };
  },
}));

let db: typeof import('../db');
let drafts: typeof import('../application/drafts');
let viral: typeof import('../application/viral');
let store: ReturnType<typeof db.getStore>;

const NOW = Date.UTC(2026, 5, 1);
const DAY = 86_400_000;
/** A word that exists only in the source post — it must never reach the model. */
const SECRET = 'SUPERSECRETORIGINALWORDING';

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-viral-gen-'));
  db = await import('../db');
  viral = await import('../application/viral');
  drafts = await import('../application/drafts');
  store = db.getStore();
  store.upsertPost({
    id: 'x:hit',
    source: 'x',
    title: 'The post that hit',
    text: `${SECRET} — a rocket launch story`,
    url: '',
    link: 'https://x.com/hit',
    score: 900,
    comments: 30,
    created: NOW - 2 * DAY,
    T: '',
    topics: '[]',
    security: 0,
    dev: 0,
    author: 'alice',
    body: `${SECRET} — a rocket launch story`,
    hashtags: '[]',
  });
  store.setPostDerived('x:hit', {
    eng: 990,
    hook: 'statement',
    hookLine: `${SECRET} — a rocket launch story`,
    words: 8,
    lengthBucket: 'short',
    hasLink: 0,
    emojiCount: 0,
    outlier: 6,
    baseline: 'author',
    analyzedAt: NOW,
  });
});

const ctx = { signal: new AbortController().signal, step: () => {}, via: () => {} };

describe('the inspiration flow', () => {
  it('hands the generator the structure of the viral post', () => {
    const brief = viral.viralBrief('x:hit', { now: NOW });
    expect(brief).toBeTruthy();
    expect(brief!.brief).toContain('The recipe:');
    expect(brief!.brief).not.toContain(SECRET);
  });

  it('puts the brief in the prompt and keeps the original wording out', async () => {
    prompts.length = 0;
    const res = await drafts.generateDrafts({ platform: 'x', inspire: 'x:hit', tone: 'casual' }, ctx);
    expect(res.status).toBe(200);
    expect(prompts.length).toBeGreaterThan(0);
    const prompt = prompts[0];
    expect(prompt).toContain('INSPIRATION BRIEF');
    expect(prompt).toContain('The recipe:');
    expect(prompt).not.toContain(SECRET); // the wording never travels
    expect(prompt).toContain('Open with a claim'); // the structure does
  });

  it('answers with the inspiration attached, so the page can show it back', async () => {
    const res = await drafts.generateDrafts({ platform: 'x', inspire: 'x:hit' }, ctx);
    const insp = (res.body as any).inspiration;
    expect(insp).toBeTruthy();
    expect(insp.id).toBe('x:hit');
    expect(insp.recipe.join(' ')).toContain('Open with a claim');
    expect(JSON.stringify(insp)).not.toContain(SECRET);
  });

  it('generates normally when no inspiration is chosen', async () => {
    prompts.length = 0;
    const res = await drafts.generateDrafts({ platform: 'x' }, ctx);
    expect(res.status).toBe(200);
    expect(prompts[0]).not.toContain('INSPIRATION BRIEF');
    expect((res.body as any).inspiration).toBeNull();
  });
});
