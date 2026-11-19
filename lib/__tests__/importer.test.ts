import { describe, expect, it } from 'vitest';
import { parseImport } from '../importer';

describe('parseImport', () => {
  it('reads a CSV export with a header row', () => {
    const csv = [
      'text,likes,comments,date,url',
      'Hello world,10,2,2026-11-01,https://x.com/alice/status/1',
      '"A post, with a comma",5,0,2026-11-02,https://linkedin.com/posts/bob',
    ].join('\n');
    const r = parseImport(csv);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ platform: 'X', text: 'Hello world', eng: 14, link: 'https://x.com/alice/status/1' });
    expect(r.rows[1]).toMatchObject({ platform: 'LinkedIn', text: 'A post, with a comma', eng: 5 });
  });

  it('prefers an explicit engagements column', () => {
    const r = parseImport('text,engagements,likes\nPost,99,1');
    expect(r.rows[0].eng).toBe(99);
  });

  it('reads markdown tables', () => {
    const md = [
      '| text | likes | comments |',
      '| --- | --- | --- |',
      '| Security tip | 12 | 3 |',
    ].join('\n');
    const r = parseImport(md);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ text: 'Security tip', eng: 18 });
  });

  it('reads loose "text - number" lines', () => {
    const r = parseImport('A post about bugs - 1,234\nAnother one | 42\nno number here');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ text: 'A post about bugs', eng: 1234 });
    expect(r.rows[1].eng).toBe(42);
    expect(r.skipped).toBe(1);
  });

  it('detects the platform from the link', () => {
    const r = parseImport([
      'text,likes,url',
      'Insta post,5,https://instagram.com/p/abc',
      'Threads post,5,https://threads.net/@a/post/1',
    ].join('\n'));
    expect(r.rows[0].platform).toBe('Instagram');
    expect(r.rows[1].platform).toBe('Threads');
  });

  it('caps a huge paste at 200 rows', () => {
    const raw = Array.from({ length: 250 }, (_, i) => `post ${i} - ${i + 1}`).join('\n');
    const r = parseImport(raw);
    expect(r.rows).toHaveLength(200);
    expect(r.notes.some(n => n.includes('capped'))).toBe(true);
  });

  it('returns a note for an empty paste', () => {
    expect(parseImport('   ').notes[0]).toMatch(/nothing pasted/);
  });
});
