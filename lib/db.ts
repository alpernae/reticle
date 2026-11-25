// social-panel storage — SQLite via node:sqlite (built into Node ≥22, zero native deps).
// Server-side only. One database file: <project>/data.sqlite (WAL journal).
// data.json is a legacy store: on first open its contents are migrated in, then
// the file is left untouched as a backup snapshot.
import 'server-only';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATION_VERSION, runMigrations } from './db/migrate';

// DATA_DIR lets Docker keep the database on a volume (/data); locally it's the project folder.
export const DATA_DIR = process.env.DATA_DIR || process.cwd();
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
export const DB_FILE = path.join(DATA_DIR, 'data.sqlite');
const JSON_FILE = path.join(DATA_DIR, 'data.json');

export type PostRow = {
  id: string; source: string; title: string; text: string; url: string; link: string;
  score: number; comments: number; created: number;
  T: string; topics: string; security: number; dev: number;
  views?: number | null;
  // rich fields (v2 normalizer) — null when the platform/actor did not return them
  author?: string | null;
  authorFollowers?: number | null;
  authorLocation?: string | null; // free-text profile location ("Berlin", "🇮🇳", "SF Bay Area")
  shares?: number | null;    // reposts / retweets / shares
  saves?: number | null;     // bookmarks / saves
  media?: string | null;     // text | image | carousel | video | short | thread | poll | link | article
  hashtags?: string | null;  // JSON array
  body?: string | null;      // full post text / caption / video title + description
  durationSec?: number | null;
  aiCats?: string | null;    // JSON array of category keys assigned by Claude (lib/categorize.ts)
};
export type MetaValue<T> = T | null;
export type AutomationRow = {
  id: string; name: string; description: string; enabled: number;
  steps: string; schedule: string; nextRun: number | null; lastRun: number | null;
  history: string; created: number; updated: number;
};
export type CollectorRunRow = {
  id: string; platform: string; actor: string; ts: number; status: string;
  items: number | null; imported: string | null; error: string | null; note: string | null; costUsd: number | null;
};
export type ProviderHealthRow = {
  key: string; ok: number | null; msg: string | null; ts: number | null;
  retryAt: number | null; latencyMs: number | null;
};
export type MindMapRow = {
  id: string; title: string; nodes: string; edges: string; created: number; updated: number;
};
export type TrackerRow = {
  id: string; preset: string; name: string; project: string; startDate: string; totalDays: number;
  headline: string; hashtags: string; fields: string; values: string; log: string; created: number; updated: number;
};
export type TaskRow = {
  id: string; kind: string; parentId: string | null; status: string;
  input: string; output: string | null; error: string | null; checkpoint: string | null;
  provider: string; model: string; attempts: number; maxAttempts: number;
  runAfter: number; leaseUntil: number | null; cancelRequested: number;
  title: string; page: string; platform: string; trigger: string;
  created: number; started: number | null; finished: number | null;
};
export type TaskEventRow = {
  taskId: string; seq: number; at: number; type: string; label: string | null; state: string | null; data: string | null;
};

/** Depth of the current transaction on this connection (SQLite has one). */
let txDepth = 0;

// The tasks table is selected with explicit aliases — snake_case columns come
// back camelCased so the rest of the app never has to know the column names.
const TASK_COLUMNS = `id, kind, parent_id AS parentId, status, input, output, error, checkpoint, provider, model,
  attempts, max_attempts AS maxAttempts, run_after AS runAfter, lease_until AS leaseUntil,
  cancel_requested AS cancelRequested, title, page, platform, trigger, created, started, finished`;
const TASK_SELECT = `SELECT ${TASK_COLUMNS} FROM tasks`;

export class SocialDB {
  db: DatabaseSync;
  private stmts: Map<string, StatementSync>;
  constructor(db: DatabaseSync, stmts = new Map<string, StatementSync>()) { this.db = db; this.stmts = stmts; }

  /** Prepared-statement cache shared by every SocialDB wrapper on this handle. */
  private prep(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) { s = this.db.prepare(sql); this.stmts.set(sql, s); }
    return s;
  }

  // ---- transactions ----
  /** Run `fn` inside one write transaction; nested calls join the outer one.
   *  Rolls back and rethrows on error, so a failed import never leaves half a
   *  dataset behind (and a 1,000-post import costs one commit, not 3,000). */
  tx<T>(fn: () => T): T {
    if (txDepth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    txDepth++;
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw e;
    } finally {
      txDepth--;
    }
  }

  // ---- posts ----
  upsertPost(p: PostRow) {
    const s = this.prep(
      `INSERT INTO posts (id, source, title, text, url, link, score, comments, created, T, topics, security, dev)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET score = excluded.score, comments = excluded.comments`
    );
    s.run(p.id, p.source, p.title, p.text, p.url, p.link, p.score, p.comments, p.created, p.T, p.topics, p.security, p.dev);
    if (p.views != null) this.prep('UPDATE posts SET views = ? WHERE id = ?').run(p.views, p.id);
    this.prep(
      `UPDATE posts SET author = COALESCE(?, author), authorFollowers = COALESCE(?, authorFollowers),
         shares = COALESCE(?, shares), saves = COALESCE(?, saves), media = COALESCE(?, media),
         hashtags = COALESCE(?, hashtags), body = COALESCE(?, body), durationSec = COALESCE(?, durationSec),
         authorLocation = COALESCE(?, authorLocation)
       WHERE id = ?`
    ).run(p.author ?? null, p.authorFollowers ?? null, p.shares ?? null, p.saves ?? null, p.media ?? null,
      p.hashtags ?? null, p.body ?? null, p.durationSec ?? null, p.authorLocation || null, p.id);
  }
  setAiCats(id: string, cats: string[]) { this.prep('UPDATE posts SET aiCats = ? WHERE id = ?').run(JSON.stringify(cats), id); }
  setClassification(id: string, T: string, topics: string, security: number, dev: number) {
    this.prep('UPDATE posts SET T = ?, topics = ?, security = ?, dev = ? WHERE id = ?').run(T, topics, security, dev, id);
  }
  hasPost(id: string): boolean { return !!this.prep('SELECT 1 FROM posts WHERE id = ?').get(id); }
  updateScores(id: string, score: number, comments: number) {
    this.prep('UPDATE posts SET score = ?, comments = ? WHERE id = ?').run(score, comments, id);
  }
  prunePosts(minCreated: number, keep = 6000) {
    this.prep('DELETE FROM posts WHERE created > 0 AND created < ?').run(minCreated);
    this.prep('DELETE FROM posts WHERE id NOT IN (SELECT id FROM posts ORDER BY created DESC, id DESC LIMIT ?)').run(keep);
  }
  allPosts(): PostRow[] { return this.prep('SELECT * FROM posts').all() as unknown as PostRow[]; }

  // ---- analytics read model (ADR-004) ----
  /** The columns the read model needs — not every column (the body can be 5 KB). */
  analyticsPostRows(): {
    id: string; source: string; title: string; text: string; link: string; score: number; comments: number;
    created: number; topics: string; security: number; dev: number; views: number | null;
    author: string | null; authorFollowers: number | null; authorLocation: string | null;
    shares: number | null; saves: number | null; media: string | null; hashtags: string | null;
    body: string | null; durationSec: number | null;
  }[] {
    return this.prep(`SELECT id, source, title, text, link, score, comments, created, topics, security, dev,
      views, author, authorFollowers, authorLocation, shares, saves, media, hashtags, body, durationSec
      FROM posts`).all() as unknown as ReturnType<SocialDB['analyticsPostRows']>;
  }
  /** Write the derived facts of one post (engagement, hook, length, outlier …).
   *  A null outlier means "no yardstick yet" — the rebuild fills it in. */
  setPostDerived(id: string, d: {
    eng: number; hook: string; hookLine: string; words: number; lengthBucket: string;
    hasLink: number; emojiCount: number; outlier?: number | null; baseline?: string | null; analyzedAt: number;
  }) {
    if (d.outlier == null) {
      this.prep(`UPDATE posts SET eng = ?, hook = ?, hookLine = ?, words = ?, lengthBucket = ?,
        hasLink = ?, emojiCount = ?, analyzedAt = ? WHERE id = ?`)
        .run(d.eng, d.hook, d.hookLine, d.words, d.lengthBucket, d.hasLink, d.emojiCount, d.analyzedAt, id);
      return;
    }
    this.prep(`UPDATE posts SET eng = ?, hook = ?, hookLine = ?, words = ?, lengthBucket = ?,
      hasLink = ?, emojiCount = ?, outlier = ?, baseline = ?, analyzedAt = ? WHERE id = ?`)
      .run(d.eng, d.hook, d.hookLine, d.words, d.lengthBucket, d.hasLink, d.emojiCount,
        d.outlier, d.baseline ?? 'platform', d.analyzedAt, id);
  }
  /** Replace the whole author baseline table (it is rebuilt from the posts). */
  replaceAuthorBaselines(rows: { source: string; author: string; n: number; medianEng: number; updated: number }[]) {
    this.prep('DELETE FROM author_baselines').run();
    const ins = this.prep('INSERT INTO author_baselines (source, author, n, median_eng, updated) VALUES (?, ?, ?, ?, ?)');
    for (const r of rows) ins.run(r.source, r.author, r.n, r.medianEng, r.updated);
  }
  replacePlatformBaselines(rows: { source: string; n: number; medianEng: number; medianPerFollower: number; updated: number }[]) {
    this.prep('DELETE FROM platform_baselines').run();
    const ins = this.prep('INSERT INTO platform_baselines (source, n, median_eng, median_per_follower, updated) VALUES (?, ?, ?, ?, ?)');
    for (const r of rows) ins.run(r.source, r.n, r.medianEng, r.medianPerFollower, r.updated);
  }
  readAnalyticsSnapshot(): { version: number; computedAt: number; tz: string; payload: string } | undefined {
    const r = this.prep('SELECT version, computed_at, tz, payload FROM analytics_snapshot WHERE id = 1').get() as
      | { version: number; computed_at: number; tz: string; payload: string } | undefined;
    if (!r) return undefined;
    return { version: r.version, computedAt: r.computed_at, tz: r.tz, payload: r.payload };
  }
  writeAnalyticsSnapshot(s: { version: number; computedAt: number; tz: string; payload: string }) {
    this.prep(`INSERT INTO analytics_snapshot (id, version, computed_at, tz, payload) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET version = excluded.version, computed_at = excluded.computed_at,
      tz = excluded.tz, payload = excluded.payload`)
      .run(s.version, s.computedAt, s.tz, s.payload);
  }
  /**
   * The timing + outlier facts of every post, straight from the derived
   * columns. The Best-time card and the Feed read this instead of running the
   * analyzer on every request.
   */
  outlierRows(): {
    id: string; source: string; title: string; link: string; created: number; outlier: number;
    author: string | null; authorLocation: string | null;
  }[] {
    return this.prep(`SELECT id, source, title, link, created, COALESCE(outlier, 0) AS outlier,
      author, authorLocation FROM posts WHERE created > 0`).all() as unknown as ReturnType<SocialDB['outlierRows']>;
  }

  /**
   * The posts that carry an outlier score, newest first — the feed and best-time card read this. */
  rankedPostRows(limit: number, source?: string): {
    id: string; source: string; title: string; link: string; score: number; comments: number; created: number;
    outlier: number; eng: number; hook: string; words: number; lengthBucket: string; hasLink: number;
    emojiCount: number; author: string | null; authorFollowers: number | null; authorLocation: string | null;
    media: string | null; hashtags: string | null; body: string | null; views: number | null; shares: number | null; saves: number | null;
  }[] {
    const where = source ? 'WHERE source = ?' : '';
    const args = source ? [source, limit] : [limit];
    return this.prep(`SELECT id, source, title, link, score, comments, created, outlier, eng, hook, words,
      lengthBucket, hasLink, emojiCount, author, authorFollowers, authorLocation, media, hashtags, body, views, shares, saves
      FROM posts ${where} ORDER BY outlier DESC, eng DESC LIMIT ?`).all(...args) as unknown as ReturnType<SocialDB['rankedPostRows']>;
  }

  /**
   * The candidates for the viral finder: the materialized read model, filtered
   * in SQL (platform, age, minimum lift) and returned biggest-lift first.
   * The body comes back truncated — a card needs a preview, and the full text
   * is fetched on its own when a post is used as inspiration.
   */
  viralCandidateRows(opts: { sources?: string[]; since?: number; minLift?: number; limit?: number } = {}): {
    id: string; source: string; title: string; text: string; link: string; score: number; comments: number;
    created: number; topics: string; views: number | null; author: string | null; authorFollowers: number | null;
    shares: number | null; saves: number | null; media: string | null; hashtags: string | null;
    body: string | null; durationSec: number | null;
    eng: number; outlier: number; baseline: string; hook: string; hookLine: string; words: number;
    lengthBucket: string; hasLink: number; emojiCount: number;
  }[] {
    const where: string[] = ['created > 0', 'outlier IS NOT NULL'];
    const args: any[] = [];
    if (opts.sources?.length) {
      where.push(`source IN (${opts.sources.map(() => '?').join(', ')})`);
      args.push(...opts.sources);
    }
    if (opts.since) { where.push('created >= ?'); args.push(opts.since); }
    if (opts.minLift != null) { where.push('outlier >= ?'); args.push(opts.minLift); }
    args.push(Math.max(1, Math.min(1000, opts.limit ?? 500)));
    return this.prep(`SELECT id, source, title, text, link, score, comments, created, topics, views, author,
      authorFollowers, shares, saves, media, hashtags, substr(body, 1, 1200) AS body, durationSec,
      eng, outlier, COALESCE(baseline, 'platform') AS baseline, COALESCE(hook, 'statement') AS hook,
      COALESCE(hookLine, '') AS hookLine, COALESCE(words, 0) AS words,
      COALESCE(lengthBucket, 'short') AS lengthBucket, COALESCE(hasLink, 0) AS hasLink,
      COALESCE(emojiCount, 0) AS emojiCount
      FROM posts WHERE ${where.join(' AND ')} ORDER BY outlier DESC, eng DESC LIMIT ?`)
      .all(...args) as unknown as ReturnType<SocialDB['viralCandidateRows']>;
  }

  /** One post with its full body — the inspiration flow reads the original. */
  viralSourcePost(id: string): {
    id: string; source: string; title: string; text: string; link: string; score: number; comments: number;
    created: number; topics: string; views: number | null; author: string | null; authorFollowers: number | null;
    shares: number | null; saves: number | null; media: string | null; hashtags: string | null;
    body: string | null; durationSec: number | null;
    eng: number; outlier: number; baseline: string; hook: string; hookLine: string; words: number;
    lengthBucket: string; hasLink: number; emojiCount: number;
  } | undefined {
    return this.prep(`SELECT id, source, title, text, link, score, comments, created, topics, views, author,
      authorFollowers, shares, saves, media, hashtags, body, durationSec,
      eng, outlier, COALESCE(baseline, 'platform') AS baseline, COALESCE(hook, 'statement') AS hook,
      COALESCE(hookLine, '') AS hookLine, COALESCE(words, 0) AS words,
      COALESCE(lengthBucket, 'short') AS lengthBucket, COALESCE(hasLink, 0) AS hasLink,
      COALESCE(emojiCount, 0) AS emojiCount
      FROM posts WHERE id = ?`).get(id) as unknown as ReturnType<SocialDB['viralSourcePost']>;
  }

  // ---- page-scoped reads (ADR-004) ----
  /** Run a read query with bound parameters (prepared statements are cached by SQL text). */
  queryAll<T = any>(sql: string, args: any[] = []): T[] { return this.prep(sql).all(...args) as unknown as T[]; }
  queryOne<T = any>(sql: string, args: any[] = []): T | undefined { return this.prep(sql).get(...args) as unknown as T | undefined; }

  /**
   * The compact post projection the read endpoints serve: no body, no
   * classifier text, no hashtags — only the facts a page renders.
   */
  compactPostRows(): {
    id: string; source: string; title: string; link: string; score: number; comments: number;
    created: number; security: number; topics: string; aiCats: string | null; views: number | null;
    author: string | null; authorFollowers: number | null; authorLocation: string | null; media: string | null;
    eng: number | null; outlier: number | null;
  }[] {
    return this.prep(`SELECT id, source, title, link, score, comments, created, security, topics, aiCats,
      views, author, authorFollowers, authorLocation, media, eng, outlier FROM posts WHERE created > 0`).all() as unknown as
      ReturnType<SocialDB['compactPostRows']>;
  }

  /**
   * The analyzed projection, straight from the derived columns (ADR-004).
   * The winners/patterns page reads this instead of running the analyzer on
   * every request.
   */
  analyzedPostRows(): {
    id: string; source: string; title: string; text: string; link: string; score: number; comments: number;
    created: number; topics: string; aiCats: string | null; security: number; dev: number; views: number | null;
    author: string | null; authorFollowers: number | null; authorLocation: string | null;
    shares: number | null; saves: number | null; media: string | null; hashtags: string | null; body: string | null;
    durationSec: number | null; eng: number | null; outlier: number | null; baseline: string | null;
    hook: string | null; hookLine: string | null; words: number | null; lengthBucket: string | null;
    hasLink: number | null; emojiCount: number | null;
  }[] {
    return this.prep(`SELECT id, source, title, text, link, score, comments, created, topics, aiCats, security, dev,
      views, author, authorFollowers, authorLocation, shares, saves, media, hashtags, body, durationSec,
      eng, outlier, baseline, hook, hookLine, words, lengthBucket, hasLink, emojiCount FROM posts`).all() as unknown as
      ReturnType<SocialDB['analyzedPostRows']>;
  }

  /** How many posts per source — the platform tabs. */  sourceCounts(): Record<string, number> {
    const rows = this.prep('SELECT source, COUNT(*) c FROM posts GROUP BY source').all() as { source: string; c: number }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.source] = r.c;
    return out;
  }

  /** How many posts still miss their derived facts (the read model has not caught up). */
  countUnanalyzed(): number {
    return (this.prep('SELECT COUNT(*) c FROM posts WHERE eng IS NULL').get() as { c: number }).c;
  }

  /** The stored yardsticks — what an imported post is measured against. */
  readAuthorBaselines(): { source: string; author: string; n: number; medianEng: number }[] {
    return this.prep('SELECT source, author, n, median_eng AS medianEng FROM author_baselines').all() as
      { source: string; author: string; n: number; medianEng: number }[];
  }
  readPlatformBaselines(): { source: string; n: number; medianEng: number; medianPerFollower: number }[] {
    return this.prep('SELECT source, n, median_eng AS medianEng, median_per_follower AS medianPerFollower FROM platform_baselines').all() as
      { source: string; n: number; medianEng: number; medianPerFollower: number }[];
  }

  // ---- manual (my results) ----
  addManual(m: { id: number; platform: string; text: string; eng: number; when: string; ts: number; likes?: number | null; comments?: number | null; views?: number | null }) {
    this.prep('INSERT INTO manual (id, platform, text, eng, "when", ts, likes, comments, views) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(m.id, m.platform, m.text, m.eng, m.when, m.ts, m.likes ?? null, m.comments ?? null, m.views ?? null);
  }
  /** Whitelisted partial update — undefined = leave unchanged, null = clear. */
  updateManual(id: number, f: { eng?: number; when?: string; likes?: number | null; comments?: number | null; views?: number | null }) {
    const cols: string[] = [], vals: any[] = [];
    if (f.eng !== undefined) { cols.push('eng = ?'); vals.push(f.eng); }
    if (f.when !== undefined) { cols.push('"when" = ?', 'ts = ?'); vals.push(f.when, Date.parse(f.when) || Date.now()); }
    if (f.likes !== undefined) { cols.push('likes = ?'); vals.push(f.likes); }
    if (f.comments !== undefined) { cols.push('comments = ?'); vals.push(f.comments); }
    if (f.views !== undefined) { cols.push('views = ?'); vals.push(f.views); }
    if (!cols.length) return;
    vals.push(id);
    this.prep(`UPDATE manual SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
  }
  delManual(id: number) { this.prep('DELETE FROM manual WHERE id = ?').run(id); }
  allManual(): { id: number; platform: string; text: string; eng: number; when: string; ts: number; likes: number | null; comments: number | null; views: number | null }[] {
    return this.prep('SELECT id, platform, text, eng, "when", ts, likes, comments, views FROM manual ORDER BY ts DESC').all() as unknown as { id: number; platform: string; text: string; eng: number; when: string; ts: number; likes: number | null; comments: number | null; views: number | null }[];
  }
  /** How many results the user has logged. */
  countManual(): number { return (this.prep('SELECT COUNT(*) c FROM manual').get() as { c: number }).c; }

  // ---- meta (lastCollect, lastAI, lastGoodModel, lastAnalysis) ----
  getMeta(key: string): string | null {
    const r = this.prep('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }
  setMeta(key: string, value: string) {
    this.prep('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  // ---- settings (typed user configuration; JSON text) ----
  getSettingRow(key: string): { value: string; version: number } | undefined {
    return this.prep('SELECT value, version FROM settings WHERE key = ?').get(key) as
      { value: string; version: number } | undefined;
  }
  setSettingRow(key: string, value: string, version = 1) {
    this.prep(`INSERT INTO settings (key, value, version, updated) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = excluded.version, updated = excluded.updated`)
      .run(key, value, version, Date.now());
  }
  deleteSettingRow(key: string) { this.prep('DELETE FROM settings WHERE key = ?').run(key); }
  countSettings(): number { return (this.prep('SELECT COUNT(*) c FROM settings').get() as { c: number }).c; }

  // ---- automations (scheduled AI pipelines; JSON columns for steps/schedule/history) ----
  listAutomationRows(): AutomationRow[] {
    return this.prep(`SELECT id, name, description, enabled, steps, schedule,
      next_run AS nextRun, last_run AS lastRun, history, created, updated
      FROM automations ORDER BY created DESC`).all() as unknown as AutomationRow[];
  }
  getAutomationRow(id: string): AutomationRow | undefined {
    return this.prep(`SELECT id, name, description, enabled, steps, schedule,
      next_run AS nextRun, last_run AS lastRun, history, created, updated
      FROM automations WHERE id = ?`).get(id) as AutomationRow | undefined;
  }
  upsertAutomationRow(a: AutomationRow) {
    this.prep(`INSERT INTO automations (id, name, description, enabled, steps, schedule, next_run, last_run, history, created, updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
         enabled = excluded.enabled, steps = excluded.steps, schedule = excluded.schedule,
         next_run = excluded.next_run, last_run = excluded.last_run, history = excluded.history,
         created = excluded.created, updated = excluded.updated`)
      .run(a.id, a.name, a.description, a.enabled, a.steps, a.schedule, a.nextRun, a.lastRun, a.history, a.created, a.updated);
  }
  deleteAutomationRow(id: string) { this.prep('DELETE FROM automations WHERE id = ?').run(id); }

  // ---- collector runs (Apify history; newest first, pruned) ----
  listCollectorRunRows(limit = 80): CollectorRunRow[] {
    return this.prep(`SELECT id, platform, actor, ts, status, items, imported, error, note,
      cost_usd AS costUsd FROM collector_runs ORDER BY ts DESC LIMIT ?`).all(limit) as unknown as CollectorRunRow[];
  }
  getCollectorRunRow(id: string): CollectorRunRow | undefined {
    return this.prep(`SELECT id, platform, actor, ts, status, items, imported, error, note,
      cost_usd AS costUsd FROM collector_runs WHERE id = ?`).get(id) as CollectorRunRow | undefined;
  }
  upsertCollectorRunRow(r: CollectorRunRow) {
    this.prep(`INSERT INTO collector_runs (id, platform, actor, ts, status, items, imported, error, note, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET platform = excluded.platform, actor = excluded.actor, ts = excluded.ts,
         status = excluded.status, items = excluded.items, imported = excluded.imported,
         error = excluded.error, note = excluded.note, cost_usd = excluded.cost_usd`)
      .run(r.id, r.platform, r.actor, r.ts, r.status, r.items, r.imported, r.error, r.note, r.costUsd);
  }
  /** Whitelisted partial update — undefined = leave unchanged, null = clear. */
  patchCollectorRunRow(id: string, f: Partial<Omit<CollectorRunRow, 'id'>>) {
    const cols: string[] = [], vals: any[] = [];
    const put = (col: string, v: unknown) => { if (v !== undefined) { cols.push(`${col} = ?`); vals.push(v); } };
    put('platform', f.platform); put('actor', f.actor); put('ts', f.ts); put('status', f.status);
    put('items', f.items); put('imported', f.imported); put('error', f.error); put('note', f.note); put('cost_usd', f.costUsd);
    if (!cols.length) return;
    vals.push(id);
    this.prep(`UPDATE collector_runs SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
  }
  pruneCollectorRuns(keep = 80) {
    this.prep('DELETE FROM collector_runs WHERE id NOT IN (SELECT id FROM collector_runs ORDER BY ts DESC LIMIT ?)').run(keep);
  }

  // ---- cache (small derived values; never authoritative) ----
  getCacheEntry(key: string): string | null {
    const r = this.prep('SELECT value FROM cache WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }
  setCacheEntry(key: string, value: string) {
    this.prep(`INSERT INTO cache (key, value, updated) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated`).run(key, value, Date.now());
  }
  deleteCacheEntry(key: string) { this.prep('DELETE FROM cache WHERE key = ?').run(key); }

  // ---- provider health (last outcome + latency per provider|model) ----
  listProviderHealthRows(): ProviderHealthRow[] {
    return this.prep(`SELECT key, ok, msg, ts, retry_at AS retryAt, latency_ms AS latencyMs
      FROM provider_health`).all() as unknown as ProviderHealthRow[];
  }
  getProviderHealthRow(key: string): ProviderHealthRow | undefined {
    return this.prep(`SELECT key, ok, msg, ts, retry_at AS retryAt, latency_ms AS latencyMs
      FROM provider_health WHERE key = ?`).get(key) as ProviderHealthRow | undefined;
  }
  /** Status fields overwrite; a null latency keeps the measured value. */
  upsertProviderHealthRow(r: ProviderHealthRow) {
    this.prep(`INSERT INTO provider_health (key, ok, msg, ts, retry_at, latency_ms) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET ok = excluded.ok, msg = excluded.msg, ts = excluded.ts,
         retry_at = excluded.retry_at, latency_ms = COALESCE(excluded.latency_ms, provider_health.latency_ms)`)
      .run(r.key, r.ok, r.msg, r.ts, r.retryAt, r.latencyMs);
  }
  setProviderLatency(key: string, ms: number) {
    this.prep(`INSERT INTO provider_health (key, latency_ms) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET latency_ms = excluded.latency_ms`).run(key, ms);
  }

  // ---- app state (last AI/analysis/collection markers, scheduler key) ----
  getAppState(key: string): string | null {
    const r = this.prep('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }
  setAppState(key: string, value: string) {
    this.prep(`INSERT INTO app_state (key, value, updated) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated`).run(key, value, Date.now());
  }
  deleteAppState(key: string) { this.prep('DELETE FROM app_state WHERE key = ?').run(key); }

  // ---- mind maps (nodes/edges JSON, one row per map) ----
  listMindMapRows(): MindMapRow[] {
    return this.prep('SELECT id, title, nodes, edges, created, updated FROM mindmaps ORDER BY updated DESC')
      .all() as unknown as MindMapRow[];
  }
  getMindMapRow(id: string): MindMapRow | undefined {
    return this.prep('SELECT id, title, nodes, edges, created, updated FROM mindmaps WHERE id = ?')
      .get(id) as MindMapRow | undefined;
  }
  upsertMindMapRow(m: MindMapRow) {
    this.prep(`INSERT INTO mindmaps (id, title, nodes, edges, created, updated) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, nodes = excluded.nodes, edges = excluded.edges,
         created = excluded.created, updated = excluded.updated`)
      .run(m.id, m.title, m.nodes, m.edges, m.created, m.updated);
  }
  deleteMindMapRow(id: string) { this.prep('DELETE FROM mindmaps WHERE id = ?').run(id); }

  // ---- trackers (series trackers; fields/values/log JSON columns) ----
  listTrackerRows(): TrackerRow[] {
    return this.prep(`SELECT id, preset, name, project, start_date AS startDate, total_days AS totalDays,
      headline, hashtags, fields, vals AS "values", log, created, updated FROM trackers ORDER BY created DESC`)
      .all() as unknown as TrackerRow[];
  }
  getTrackerRow(id: string): TrackerRow | undefined {
    return this.prep(`SELECT id, preset, name, project, start_date AS startDate, total_days AS totalDays,
      headline, hashtags, fields, vals AS "values", log, created, updated FROM trackers WHERE id = ?`)
      .get(id) as TrackerRow | undefined;
  }
  upsertTrackerRow(t: TrackerRow) {
    this.prep(`INSERT INTO trackers (id, preset, name, project, start_date, total_days, headline, hashtags, fields, vals, log, created, updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET preset = excluded.preset, name = excluded.name, project = excluded.project,
         start_date = excluded.start_date, total_days = excluded.total_days, headline = excluded.headline,
         hashtags = excluded.hashtags, fields = excluded.fields, vals = excluded.vals, log = excluded.log,
         created = excluded.created, updated = excluded.updated`)
      .run(t.id, t.preset, t.name, t.project, t.startDate, t.totalDays, t.headline, t.hashtags,
        t.fields, t.values, t.log, t.created, t.updated);
  }
  /** Drop trackers that are no longer in the saved set. */
  deleteTrackersNotIn(ids: string[]) {
    const keep = ids.filter(Boolean);
    if (!keep.length) { this.prep('DELETE FROM trackers').run(); return; }
    const marks = keep.map(() => '?').join(',');
    this.prep(`DELETE FROM trackers WHERE id NOT IN (${marks})`).run(...keep);
  }

  // ---- tasks (the durable task system; one row per long-running job) ----
  addTaskRow(t: TaskRow) {
    this.prep(`INSERT INTO tasks (id, kind, parent_id, status, input, output, error, checkpoint, provider, model,
      attempts, max_attempts, run_after, lease_until, cancel_requested, title, page, platform, trigger, created, started, finished)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(t.id, t.kind, t.parentId, t.status, t.input, t.output, t.error, t.checkpoint, t.provider, t.model,
        t.attempts, t.maxAttempts, t.runAfter, t.leaseUntil, t.cancelRequested, t.title, t.page, t.platform, t.trigger,
        t.created, t.started, t.finished);
  }
  getTaskRow(id: string): TaskRow | undefined {
    return this.prep(`${TASK_SELECT} WHERE id = ?`).get(id) as TaskRow | undefined;
  }
  listTaskRows(opts: { kind?: string; status?: string; limit?: number } = {}): TaskRow[] {
    const where: string[] = [];
    const vals: any[] = [];
    if (opts.kind) { where.push('kind = ?'); vals.push(opts.kind); }
    if (opts.status) { where.push('status = ?'); vals.push(opts.status); }
    const sql = `${TASK_SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created DESC LIMIT ?`;
    vals.push(Math.max(1, Math.min(1000, opts.limit ?? 100)));
    return this.prep(sql).all(...vals) as unknown as TaskRow[];
  }
  /** Whitelisted partial update — undefined = leave unchanged, null = clear. */
  patchTaskRow(id: string, f: Partial<Omit<TaskRow, 'id'>>) {
    const cols: string[] = [], vals: any[] = [];
    const put = (col: string, v: unknown) => { if (v !== undefined) { cols.push(`${col} = ?`); vals.push(v); } };
    put('kind', f.kind); put('parent_id', f.parentId); put('status', f.status);
    put('input', f.input); put('output', f.output); put('error', f.error); put('checkpoint', f.checkpoint);
    put('provider', f.provider); put('model', f.model);
    put('attempts', f.attempts); put('max_attempts', f.maxAttempts);
    put('run_after', f.runAfter); put('lease_until', f.leaseUntil); put('cancel_requested', f.cancelRequested);
    put('title', f.title); put('page', f.page); put('platform', f.platform); put('trigger', f.trigger);
    put('created', f.created); put('started', f.started); put('finished', f.finished);
    if (!cols.length) return;
    vals.push(id);
    this.prep(`UPDATE tasks SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
  }
  /** Claim the next ready task: due, and of a kind the worker may run.
   *  The UPDATE … RETURNING makes the claim atomic — two workers can never
   *  take the same row. A task that was 'waiting' (a collect task polling
   *  Apify) continues without spending an attempt: only a fresh run counts. */
  claimNextTaskRow(now: number, leaseMs: number, kinds: string[]): TaskRow | undefined {
    if (!kinds.length) return undefined;
    const marks = kinds.map(() => '?').join(',');
    const row = this.prep(
      `UPDATE tasks SET status = 'running', lease_until = ?, attempts = attempts + CASE WHEN status = 'waiting' THEN 0 ELSE 1 END,
         started = COALESCE(started, ?), finished = NULL
       WHERE id = (SELECT id FROM tasks WHERE status IN ('queued', 'waiting') AND run_after <= ? AND kind IN (${marks})
                   ORDER BY run_after ASC, created ASC LIMIT 1)
       RETURNING ${TASK_COLUMNS}`)
      .get(now + leaseMs, now, now, ...kinds);
    return row as TaskRow | undefined;
  }
  /** Keep the lease alive while the handler runs. */
  extendTaskLease(id: string, until: number) {
    this.prep('UPDATE tasks SET lease_until = ? WHERE id = ?').run(until, id);
  }
  /** Recover work whose owner is gone: an expired lease, or a task started by
   *  a previous server process (bootAt is this process's start time). */
  recoverStaleTasks(now: number, bootAt: number): number {
    return this.prep(
      `UPDATE tasks SET status = 'queued', lease_until = NULL, error = 'recovered after the server restarted'
       WHERE status = 'running' AND (lease_until IS NULL OR lease_until < ? OR started IS NULL OR started < ?)`)
      .run(now, bootAt).changes as number;
  }
  deleteTaskRow(id: string) { this.prep('DELETE FROM tasks WHERE id = ?').run(id); }
  /** Remove finished tasks. Workflows are kept — they have their own page. */
  clearFinishedTasks(): number {
    return this.prep("DELETE FROM tasks WHERE status IN ('done', 'failed', 'cancelled') AND kind != 'workflow'")
      .run().changes as number;
  }
  /** How many tasks of a kind are there (the Settings page's data card). */
  countTaskRows(kind?: string): number {
    return kind
      ? (this.prep('SELECT COUNT(*) AS n FROM tasks WHERE kind = ?').get(kind) as { n: number }).n as number
      : (this.prep('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n as number;
  }
  /** Keep the newest `keep` finished tasks; queued/running ones are never pruned. */
  pruneFinishedTasks(keep = 1000): number {
    return this.prep(
      `DELETE FROM tasks WHERE status IN ('done', 'failed', 'cancelled')
         AND id NOT IN (SELECT id FROM tasks WHERE status IN ('done', 'failed', 'cancelled') ORDER BY created DESC LIMIT ?)`)
      .run(keep).changes as number;
  }
  // ---- task events (the step log) ----
  addTaskEventRow(e: { taskId: string; at: number; type: string; label?: string | null; state?: string | null; data?: string | null }) {
    const seq = ((this.prep('SELECT COALESCE(MAX(seq), 0) + 1 s FROM task_events WHERE task_id = ?').get(e.taskId) as { s: number }).s);
    this.prep('INSERT INTO task_events (task_id, seq, at, type, label, state, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(e.taskId, seq, e.at, e.type, e.label ?? null, e.state ?? null, e.data ?? null);
  }
  listTaskEventRows(taskId: string): TaskEventRow[] {
    return this.prep('SELECT task_id AS taskId, seq, at, type, label, state, data FROM task_events WHERE task_id = ? ORDER BY seq ASC')
      .all(taskId) as unknown as TaskEventRow[];
  }
  /** Close the task's open step — it is done (or failed). */
  closeActiveTaskStep(taskId: string, state: 'done' | 'failed' = 'done') {
    this.prep("UPDATE task_events SET state = ? WHERE task_id = ? AND type = 'step' AND state = 'active'").run(state, taskId);
  }

  // ---- secrets (AES-256-GCM rows; encryption lives in lib/secrets.ts) ----
  getSecretRow(name: string): { ciphertext: string; iv: string; tag: string } | undefined {
    return this.prep('SELECT ciphertext, iv, tag FROM secrets WHERE name = ?').get(name) as
      { ciphertext: string; iv: string; tag: string } | undefined;
  }
  setSecretRow(name: string, ciphertext: string, iv: string, tag: string) {
    this.prep(`INSERT INTO secrets (name, ciphertext, iv, tag, updated) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag, updated = excluded.updated`)
      .run(name, ciphertext, iv, tag, Date.now());
  }
  deleteSecretRow(name: string) { this.prep('DELETE FROM secrets WHERE name = ?').run(name); }
  countSecrets(): number { return (this.prep('SELECT COUNT(*) c FROM secrets').get() as { c: number }).c; }

  // ---- auth (owner account + local sessions) ----
  countUsers(): number {
    return (this.prep('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
  }
  addUser(username: string, passHash: string) {
    this.prep('INSERT INTO users (username, passHash, created) VALUES (?, ?, ?)').run(username, passHash, Date.now());
  }
  getUser(username: string): { username: string; passHash: string; created: number } | undefined {
    return this.prep('SELECT username, passHash, created FROM users WHERE username = ?')
      .get(username) as { username: string; passHash: string; created: number } | undefined;
  }
  addSession(token: string, user: string, expires: number) {
    this.prep('INSERT INTO sessions (token, user, created, expires) VALUES (?, ?, ?, ?)').run(token, user, Date.now(), expires);
  }
  getSession(token: string): { user: string; expires: number } | undefined {
    const row = this.prep('SELECT user, expires FROM sessions WHERE token = ?')
      .get(token) as { user: string; expires: number } | undefined;
    if (!row) return undefined;
    if (row.expires < Date.now()) { this.delSession(token); return undefined; } // expired → tidy up on read
    return row;
  }
  delSession(token: string) {
    this.prep('DELETE FROM sessions WHERE token = ?').run(token);
  }

  // ---- tasks are the only record of long-running work (ADR-001) ----
  // The old `jobs` (Studio runs) and `ai_runs` (Activity log) tables were
  // migrated into `tasks` by migration 009 and dropped.

  // ---- ad-hoc aggregates for analysis ----
  count(): number { return (this.prep('SELECT COUNT(*) c FROM posts').get() as { c: number }).c; }
  countMeta(): number { return (this.prep('SELECT COUNT(*) c FROM meta').get() as { c: number }).c; }
  sourceStats(sinceMs: number): { source: string; n: number; eng: number }[] {
    return this.prep(
      'SELECT source, COUNT(*) n, COALESCE(SUM(score + comments * 2), 0) eng FROM posts WHERE created > ? GROUP BY source ORDER BY eng DESC'
    ).all(sinceMs) as unknown as { source: string; n: number; eng: number }[];
  }
  securityCount(sinceMs: number): number {
    return (this.prep('SELECT COUNT(*) c FROM posts WHERE created > ? AND security = 1').get(sinceMs) as { c: number }).c;
  }
  volumeWindow(sinceMs: number): number {
    return (this.prep('SELECT COUNT(*) c FROM posts WHERE created > ?').get(sinceMs) as { c: number }).c;
  }
  topicCount(topicJsonMatch: string, sinceMs: number): number {
    return (this.prep('SELECT COUNT(*) c FROM posts WHERE created > ? AND topics LIKE ?').get(sinceMs, topicJsonMatch) as { c: number }).c;
  }
  topEngaged(sinceMs: number, limit: number): { title: string; source: string; link: string; score: number; comments: number }[] {
    return this.prep(
      'SELECT title, source, link, score, comments FROM posts WHERE created > ? ORDER BY score + comments * 2 DESC LIMIT ?'
    ).all(sinceMs, limit) as unknown as { title: string; source: string; link: string; score: number; comments: number }[];
  }
}

const g = globalThis as unknown as {
  __socialPanelSqlite?: DatabaseSync;
  __socialPanelStmts?: Map<string, StatementSync>;
  __socialPanelMigration?: number;
};

function openRaw(): DatabaseSync {
  const db = new DatabaseSync(DB_FILE);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  runMigrations(db); // versioned schema; see lib/db/migrate.ts
  return db;
}

/** One-time import: legacy data.json → SQLite (the JSON file stays as a snapshot). */
function importLegacyJson(db: DatabaseSync) {
  if (db.prepare("SELECT value FROM meta WHERE key = 'schema'").get())
    return; // already imported/stamped

  try {
    const raw = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
    const insPost = db.prepare(
      `INSERT OR IGNORE INTO posts (id, source, title, text, url, link, score, comments, created, T, topics, security, dev)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const p of raw.posts || []) {
      const topics = Array.isArray(p.topics) ? JSON.stringify(p.topics) : '[]';
      insPost.run(p.id, p.source || '', String(p.title || '').slice(0, 300), String(p.text || '').slice(0, 400), p.url || '', p.link || '',
        p.score || 0, p.comments || 0, p.created || 0, p.T || '', topics, p.security ? 1 : 0, p.dev ? 1 : 0);
    }
    const insManual = db.prepare('INSERT OR IGNORE INTO manual (id, platform, text, eng, "when", ts) VALUES (?, ?, ?, ?, ?, ?)');
    for (const m of raw.manual || []) insManual.run(m.id, m.platform || 'other', String(m.text || ''), m.eng || 0, m.when || '', m.ts || 0);
    const setState = (k: string, v: unknown) => db.prepare('INSERT OR IGNORE INTO app_state (key, value) VALUES (?, ?)').run(k, JSON.stringify(v));
    if (raw.lastCollect) setState('lastCollect', raw.lastCollect);
    if (raw.lastAI) setState('lastAI', raw.lastAI);
    if (raw.lastGoodModel) setState('lastGoodModel', raw.lastGoodModel);
    if ((raw.posts || []).length) console.info(`[reticle] migrated ${(raw.posts || []).length} posts from data.json → data.sqlite`);
  } catch { /* no data.json or unreadable — fresh install */ }

  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('schema', JSON.stringify({ v: 1, ts: Date.now() }));
}

export function getStore(): SocialDB {
  if (!g.__socialPanelSqlite) {
    const db = openRaw();
    importLegacyJson(db);
    g.__socialPanelSqlite = db;
    g.__socialPanelStmts = new Map();
    g.__socialPanelMigration = MIGRATION_VERSION;
  } else if (g.__socialPanelMigration !== MIGRATION_VERSION) {
    // Dev hot reload: this module changed while the old connection is still open.
    runMigrations(g.__socialPanelSqlite);
    g.__socialPanelMigration = MIGRATION_VERSION;
  }
  if (!g.__socialPanelStmts) g.__socialPanelStmts = new Map();
  return new SocialDB(g.__socialPanelSqlite, g.__socialPanelStmts);
}

/** Read-only facts for the Settings page's "local data" card. */
export function dbStats() {
  const store = getStore();
  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(DB_FILE).size; } catch {}
  return {
    file: DB_FILE,
    sizeBytes,
    journal: 'WAL',
    backup: JSON_FILE, // legacy data.json snapshot kept after migration
    counts: {
      posts: store.count() as number,
      winners: store.allManual().length,
      jobs: store.countTaskRows('workflow'),
      meta: store.countMeta() as number,
    },
  };
}
