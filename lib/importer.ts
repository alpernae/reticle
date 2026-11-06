// Analytics import parser — turns pasted platform exports (X Analytics CSV,
// LinkedIn stats copy, IG/TikTok tables, markdown rows, or loose "text — N"
// lines) into winner-log rows. All parsing runs locally; no platform calls.
import 'server-only';

export type ImportedRow = {
  platform: string;   // 'X' | 'LinkedIn' | 'Instagram' | 'TikTok' | 'Other'
  text: string;
  eng: number;
  when: string;
  link: string;
};

export type ImportResult = {
  rows: ImportedRow[];
  skipped: number;
  notes: string[];
};

const ALIASES: Record<string, string[]> = {
  text: ['post text', 'text', 'title', 'content', 'post', 'copy', 'post title', 'post description', 'activity', 'post name'],
  link: ['url', 'link', 'permalink', 'post url', 'post link', 'share url'],
  impressions: ['impressions', 'views', 'impr', 'reach'],
  engagements: ['engagements', 'engagement', 'total engagements', 'interactions', 'user engagements'],
  likes: ['likes', 'favorites', 'reactions', 'total reactions', 'like count'],
  comments: ['comments', 'replies', 'comments count', 'replies count'],
  shares: ['shares', 'reposts', 'retweets', 'repost count', 'share count'],
  when: ['date', 'posted', 'posted at', 'when', 'time', 'post date', 'publish date', 'created'],
};

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

const num = (s: string): number => {
  const m = String(s).replace(/[\s,%]/g, '').match(/-?\d+(\.\d+)?/);
  const v = m ? Math.round(parseFloat(m[0])) : NaN;
  return Number.isFinite(v) ? v : NaN;
};

/** Splits a CSV/TSV line, honoring double quotes. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',' || c === '\t') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Markdown table row → tab-joined cells, so one splitter handles CSV/TSV/markdown. */
const mdToTsv = (l: string) => {
  const t = l.trim();
  if (/^\|.*\|$/.test(t)) return t.slice(1, -1).split('|').map(c => c.trim()).join('\t');
  return t;
};

const detectPlatform = (link: string, text: string): string => {
  const blob = (link + ' ' + text).toLowerCase();
  if (/x\.com|twitter\.com|t\.co/.test(blob)) return 'X';
  if (/linkedin\.com/.test(blob)) return 'LinkedIn';
  if (/threads\.(net|com)/.test(blob)) return 'Threads';
  if (/instagram\.com/.test(blob)) return 'Instagram';
  if (/tiktok\.com/.test(blob)) return 'TikTok';
  return 'Other';
};

const isSeparator = (l: string) => /^[|\-:.\s]+$/.test(l);

/** Parse one pasted blob into winner rows. Strict about numbers, silent about junk. */
export function parseImport(raw: string): ImportResult {
  const notes: string[] = [];
  const lines = raw.split(/\r?\n/).map(l => mdToTsv(l)).map(l => l.trim()).filter(l => l.length > 0 && !isSeparator(l));
  if (!lines.length) return { rows: [], skipped: 0, notes: ['nothing pasted'] };

  const rows: ImportedRow[] = [];
  let skipped = 0;

  // A real table header early in the blob (≥2 known column names)?
  const headerIdx = lines.slice(0, 6).findIndex(l => {
    const cells = splitCsv(l).map(c => c.toLowerCase());
    const hits = cells.filter(c => Object.values(ALIASES).some(als => als.includes(c))).length;
    return hits >= 2 && cells.length >= 3;
  });

  if (headerIdx >= 0) {
    const headers = splitCsv(lines[headerIdx]).map(c => c.toLowerCase());
    const col = (cells: string[], name: string): string => {
      for (const alias of ALIASES[name]) {
        const i = headers.indexOf(alias);
        if (i >= 0 && i < cells.length && cells[i] !== '') return cells[i];
      }
      return '';
    };
    const body = lines.filter((_, i) => i !== headerIdx);
    for (const line of body) {
      const cells = splitCsv(line);
      const text = clean(col(cells, 'text'));
      if (!text) { skipped++; continue; }
      const views = num(col(cells, 'impressions')) || 0;
      const shares = num(col(cells, 'shares')) || 0;
      const comments = num(col(cells, 'comments')) || 0;
      const likes = num(col(cells, 'likes')) || 0;
      let eng = num(col(cells, 'engagements'));
      if (!Number.isFinite(eng) || eng <= 0) eng = likes + 2 * (comments + shares);
      if (!Number.isFinite(eng) || eng <= 0) {
        // impressions-only formats: use them as the number honestly labeled
        if (views > 0) eng = views;
        else { notes.push(`skipped "${text.slice(0, 48)}" — no engagement numbers found in its row`); skipped++; continue; }
      }
      rows.push({ platform: detectPlatform(col(cells, 'link'), text), text, eng, when: clean(col(cells, 'when')), link: col(cells, 'link').match(/https?:\/\/\S+/)?.[0] || '' });
    }
  } else {
    // loose line mode: "post text — 1,234" / "title | 42" / "text 42"
    for (const line of lines) {
      const link = line.match(/https?:\/\/\S+/)?.[0] || '';
      const noUrl = clean(line.replace(link, '')).replace(/[—–|-]\s*$/, '');
      let text = '', eng = NaN;
      const dash = noUrl.match(/^(.+?)\s*[—–|:\-]\s*(\d[\d,.]*)\s*$/);
      if (dash) { text = dash[1]; eng = num(dash[2]); }
      if (!Number.isFinite(eng)) {
        const tail = noUrl.match(/^(.{8,}?)\s+(\d[\d,.]*)$/);
        if (tail) { text = tail[1]; eng = num(tail[2]); }
      }
      if (!Number.isFinite(eng) || eng <= 0 || !text.trim()) { skipped++; continue; }
      rows.push({ platform: detectPlatform(link, text), text, eng: Math.round(eng), when: '', link });
    }
  }

  const cap = 200;
  if (rows.length > cap) { notes.push(`capped: imported the first ${cap} rows`); rows.length = cap; }
  return { rows, skipped, notes };
}
