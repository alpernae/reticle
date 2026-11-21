// lib/application/posts.ts — the Feed page's read model (ADR-004).
//
// The Feed used to download every post and filter, sort and paginate in the
// browser. Now the server does it: the page sends the filters and a cursor,
// and gets back one page of rows plus the stats for the whole filtered set.
//
// The rows are served from the compact projection (no body, no classifier
// text) and the ordering uses the derived columns — engagement and the
// breakout score are already materialized, so sorting is an indexed read.
import 'server-only';
import { getStore } from '../db';
import { TOPIC_NAMES } from '../domain/topics';

export type FeedPost = {
  id: string; title: string; link: string; score: number; comments: number; created: number;
  source: string; security: boolean; topics: string[]; views: number | null;
  author: string | null; authorFollowers: number | null; media: string | null; outlier: number;
};

export type FeedPage = {
  posts: FeedPost[];
  total: number;        // how many rows match the filters
  grandTotal: number;   // how many posts the corpus holds
  next: string | null;  // the cursor for the next page
  bySource: Record<string, number>;
  topics: string[];
  stats: { medianLikes: number; breakouts: number; security: number; newest: number; oldest: number };
};

/** Engagement, exactly as the domain computes it (the derived column wins). */
const ENG = `COALESCE(eng, score + 2 * comments + 3 * COALESCE(shares, 0) + 2 * COALESCE(saves, 0))`;
/** The breakout score (the derived column wins). */
const OUT = `COALESCE(outlier, 0)`;

export type FeedSort = 'new' | 'outlier' | 'eng' | 'views';

type Cursor = { s: FeedSort; c: number; e: number; o: number; v: number | null; i: string };

const SORTS: Record<FeedSort, {
  order: string;
  pred: (cur: Cursor) => { sql: string; args: any[] };
}> = {
  new: {
    order: 'created DESC, id DESC',
    pred: c => ({ sql: '(created < ? OR (created = ? AND id < ?))', args: [c.c, c.c, c.i] }),
  },
  eng: {
    order: `${ENG} DESC, id DESC`,
    pred: c => ({ sql: `(${ENG} < ? OR (${ENG} = ? AND id < ?))`, args: [c.e, c.e, c.i] }),
  },
  outlier: {
    order: `${OUT} DESC, ${ENG} DESC, id DESC`,
    pred: c => ({ sql: `(${OUT} < ? OR (${OUT} = ? AND (${ENG} < ? OR (${ENG} = ? AND id < ?))))`, args: [c.o, c.o, c.e, c.e, c.i] }),
  },
  views: {
    order: `(views IS NULL), views DESC, ${ENG} DESC, id DESC`,
    pred: c => c.v == null
      ? ({ sql: `((views IS NULL) AND (${ENG} < ? OR (${ENG} = ? AND id < ?)))`, args: [c.e, c.e, c.i] })
      : ({ sql: `((views IS NOT NULL) AND (views < ? OR (views = ? AND (${ENG} < ? OR (${ENG} = ? AND id < ?)))))`, args: [c.v, c.v, c.e, c.e, c.i] }),
  },
};

/** Escape the wildcards of a LIKE pattern. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

const safeList = (s: string | null | undefined): string[] => {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
};

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
const decodeCursor = (raw: string | null | undefined): Cursor | null => {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    return c && typeof c.i === 'string' ? c : null;
  } catch { return null; }
};

/** Build the WHERE parts for the filters. */
function filterSql(opts: { platform?: string; topic?: string; security?: boolean; q?: string }) {
  const parts: string[] = [];
  const args: any[] = [];
  const platform = (opts.platform || '').trim();
  const topic = (opts.topic || '').trim();
  const q = (opts.q || '').trim();
  if (platform) { parts.push('source = ?'); args.push(platform); }
  if (topic) { parts.push(`topics LIKE ? ESCAPE '\\'`); args.push(`%"${escapeLike(topic)}"%`); }
  if (opts.security) parts.push('security = 1');
  if (q) {
    const pat = `%${escapeLike(q)}%`;
    parts.push(`(title LIKE ? ESCAPE '\\' OR IFNULL(author, '') LIKE ? ESCAPE '\\' OR IFNULL(body, '') LIKE ? ESCAPE '\\')`);
    args.push(pat, pat, pat);
  }
  return { parts, args };
}

/** Compose the WHERE clause — `extra` is the cursor predicate. */
function whereClause(parts: string[], extra?: string): string {
  const all = extra ? [...parts, extra] : parts;
  return all.length ? `WHERE ${all.join(' AND ')}` : '';
}

/** One page of the Feed. */
export function listPosts(opts: {
  platform?: string; topic?: string; security?: boolean; q?: string;
  sort?: string; cursor?: string | null; limit?: number;
} = {}): FeedPage {
  const store = getStore();
  const sort: FeedSort = (['new', 'outlier', 'eng', 'views'].includes(opts.sort || '') ? opts.sort : 'new') as FeedSort;
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 100));
  const { parts, args: filterArgs } = filterSql(opts);
  const where = whereClause(parts);

  // ---- the page ----
  const cur = decodeCursor(opts.cursor);
  const useCursor = cur && cur.s === sort ? cur : null;
  const pred = useCursor ? SORTS[sort].pred(useCursor) : null;
  const sql = `SELECT id, source, title, link, score, comments, created, security, topics, views,
      author, authorFollowers, media, ${ENG} AS eng, ${OUT} AS outlier
    FROM posts ${whereClause(parts, pred?.sql)}
    ORDER BY ${SORTS[sort].order} LIMIT ?`;
  const rows = store.queryAll<any>(sql, [...filterArgs, ...(pred?.args || []), limit + 1]);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  const posts: FeedPost[] = page.map(r => ({
    id: r.id, title: r.title, link: r.link, score: r.score, comments: r.comments, created: r.created,
    source: r.source, security: !!r.security, topics: safeList(r.topics),
    views: r.views != null ? Number(r.views) : null,
    author: r.author || null, authorFollowers: r.authorFollowers != null ? Number(r.authorFollowers) : null,
    media: r.media || null, outlier: Math.round(Number(r.outlier || 0) * 100) / 100,
  }));

  // ---- the next cursor ----
  let next: string | null = null;
  if (hasMore && page.length) {
    const last = page[page.length - 1];
    next = encodeCursor({
      s: sort, c: last.created, e: Number(last.eng || 0), o: Number(last.outlier || 0),
      v: last.views != null ? Number(last.views) : null, i: last.id,
    });
  }

  // ---- the stats for the whole filtered set ----
  const countRow = store.queryOne<{ n: number }>(`SELECT COUNT(*) n FROM posts ${where}`, filterArgs);
  const total = countRow?.n ?? 0;
  const medRow = store.queryOne<{ score: number }>(
    `SELECT score FROM (SELECT score FROM posts ${where} ORDER BY score ASC) LIMIT 1 OFFSET (SELECT COUNT(*) / 2 FROM posts ${where})`,
    filterArgs);
  const outRow = store.queryOne<{ n: number }>(`SELECT COUNT(*) n FROM posts ${whereClause(parts, `${OUT} >= 2`)}`, filterArgs);
  const secRow = store.queryOne<{ n: number }>(`SELECT COUNT(*) n FROM posts ${whereClause(parts, 'security = 1')}`, filterArgs);
  const rangeRow = store.queryOne<{ newest: number; oldest: number }>(
    `SELECT IFNULL(MAX(created), 0) newest, IFNULL(MIN(created), 0) oldest FROM posts ${where}`, filterArgs);

  return {
    posts,
    total,
    grandTotal: store.count(),
    next,
    bySource: store.sourceCounts(),
    topics: TOPIC_NAMES,
    stats: {
      medianLikes: medRow?.score ?? 0,
      breakouts: outRow?.n ?? 0,
      security: secRow?.n ?? 0,
      newest: rangeRow?.newest ?? 0,
      oldest: rangeRow?.oldest ?? 0,
    },
  };
}
