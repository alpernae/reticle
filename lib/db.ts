// social-panel storage — SQLite via node:sqlite (built into Node ≥22, zero native deps).
// Server-side only. One database file: <project>/data.sqlite (WAL journal).
// data.json is a legacy store: on first open its contents are migrated in, then
// the file is left untouched as a backup snapshot.
import 'server-only';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// DATA_DIR lets Docker keep the database on a volume (/data); locally it's the project folder.
const DATA_DIR = process.env.DATA_DIR || process.cwd();
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
export type AiRunRow = {
  id: string; kind: string; title: string; page: string; platform: string; status: string; steps: string;
  provider: string; model: string; error: string; created: number; finished: number | null; ms: number | null;
};

export class SocialDB {
  db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  // ---- posts ----
  upsertPost(p: PostRow) {
    const s = this.db.prepare(
      `INSERT INTO posts (id, source, title, text, url, link, score, comments, created, T, topics, security, dev)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET score = excluded.score, comments = excluded.comments`
    );
    s.run(p.id, p.source, p.title, p.text, p.url, p.link, p.score, p.comments, p.created, p.T, p.topics, p.security, p.dev);
    if (p.views != null) this.db.prepare('UPDATE posts SET views = ? WHERE id = ?').run(p.views, p.id);
    this.db.prepare(
      `UPDATE posts SET author = COALESCE(?, author), authorFollowers = COALESCE(?, authorFollowers),
         shares = COALESCE(?, shares), saves = COALESCE(?, saves), media = COALESCE(?, media),
         hashtags = COALESCE(?, hashtags), body = COALESCE(?, body), durationSec = COALESCE(?, durationSec),
         authorLocation = COALESCE(?, authorLocation)
       WHERE id = ?`
    ).run(p.author ?? null, p.authorFollowers ?? null, p.shares ?? null, p.saves ?? null, p.media ?? null,
      p.hashtags ?? null, p.body ?? null, p.durationSec ?? null, p.authorLocation || null, p.id);
  }
  setAiCats(id: string, cats: string[]) { this.db.prepare('UPDATE posts SET aiCats = ? WHERE id = ?').run(JSON.stringify(cats), id); }
  setClassification(id: string, T: string, topics: string, security: number, dev: number) {
    this.db.prepare('UPDATE posts SET T = ?, topics = ?, security = ?, dev = ? WHERE id = ?').run(T, topics, security, dev, id);
  }
  hasPost(id: string): boolean { return !!this.db.prepare('SELECT 1 FROM posts WHERE id = ?').get(id); }
  updateScores(id: string, score: number, comments: number) {
    this.db.prepare('UPDATE posts SET score = ?, comments = ? WHERE id = ?').run(score, comments, id);
  }
  prunePosts(minCreated: number, keep = 6000) {
    this.db.prepare('DELETE FROM posts WHERE created > 0 AND created < ?').run(minCreated);
    this.db.prepare('DELETE FROM posts WHERE id NOT IN (SELECT id FROM posts ORDER BY created DESC, id DESC LIMIT ?)').run(keep);
  }
  allPosts(): PostRow[] { return this.db.prepare('SELECT * FROM posts').all() as unknown as PostRow[]; }

  // ---- manual (my results) ----
  addManual(m: { id: number; platform: string; text: string; eng: number; when: string; ts: number; likes?: number | null; comments?: number | null; views?: number | null }) {
    this.db.prepare('INSERT INTO manual (id, platform, text, eng, "when", ts, likes, comments, views) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
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
    this.db.prepare(`UPDATE manual SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
  }
  delManual(id: number) { this.db.prepare('DELETE FROM manual WHERE id = ?').run(id); }
  allManual(): { id: number; platform: string; text: string; eng: number; when: string; ts: number; likes: number | null; comments: number | null; views: number | null }[] {
    return this.db.prepare('SELECT id, platform, text, eng, "when", ts, likes, comments, views FROM manual ORDER BY ts DESC').all() as unknown as { id: number; platform: string; text: string; eng: number; when: string; ts: number; likes: number | null; comments: number | null; views: number | null }[];
  }

  // ---- meta (lastCollect, lastAI, lastGoodModel, lastAnalysis) ----
  getMeta(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }
  setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  // ---- auth (owner account + local sessions) ----
  countUsers(): number {
    return (this.db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
  }
  addUser(username: string, passHash: string) {
    this.db.prepare('INSERT INTO users (username, passHash, created) VALUES (?, ?, ?)').run(username, passHash, Date.now());
  }
  getUser(username: string): { username: string; passHash: string; created: number } | undefined {
    return this.db.prepare('SELECT username, passHash, created FROM users WHERE username = ?')
      .get(username) as { username: string; passHash: string; created: number } | undefined;
  }
  addSession(token: string, user: string, expires: number) {
    this.db.prepare('INSERT INTO sessions (token, user, created, expires) VALUES (?, ?, ?, ?)').run(token, user, Date.now(), expires);
  }
  getSession(token: string): { user: string; expires: number } | undefined {
    const row = this.db.prepare('SELECT user, expires FROM sessions WHERE token = ?')
      .get(token) as { user: string; expires: number } | undefined;
    if (!row) return undefined;
    if (row.expires < Date.now()) { this.delSession(token); return undefined; } // expired → tidy up on read
    return row;
  }
  delSession(token: string) {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  // ---- jobs (async agent runs) ----
  addJob(j: { id: string; kind: string; topic: string; platform: string; steps: string; created: number; model?: string }) {
    this.db.prepare('INSERT INTO jobs (id, kind, topic, platform, status, steps, result, err, created, started, finished, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(j.id, j.kind, j.topic, j.platform, 'queued', j.steps, '', '', j.created, null, null, j.model || '');
  }
  /** Whitelisted partial update — only these columns are ever written. */
  saveJob(id: string, f: { status?: string; steps?: string; result?: string; err?: string; started?: number | null; finished?: number | null }) {
    const cols: string[] = [], vals: any[] = [];
    if (f.status !== undefined) { cols.push('status = ?'); vals.push(f.status); }
    if (f.steps !== undefined) { cols.push('steps = ?'); vals.push(f.steps); }
    if (f.result !== undefined) { cols.push('result = ?'); vals.push(f.result); }
    if (f.err !== undefined) { cols.push('err = ?'); vals.push(f.err); }
    if (f.started !== undefined) { cols.push('started = ?'); vals.push(f.started); }
    if (f.finished !== undefined) { cols.push('finished = ?'); vals.push(f.finished); }
    if (!cols.length) return;
    vals.push(id);
    this.db.prepare(`UPDATE jobs SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
  }
  allJobs(): { id: string; kind: string; topic: string; platform: string; status: string; steps: string; result: string; err: string; created: number; started: number | null; finished: number | null }[] {
    return this.db.prepare('SELECT * FROM jobs ORDER BY created DESC LIMIT 100').all() as unknown as { id: string; kind: string; topic: string; platform: string; status: string; steps: string; result: string; err: string; created: number; started: number | null; finished: number | null }[];
  }
  getJobRow(id: string) {
    return this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as
      | { id: string; kind: string; topic: string; platform: string; status: string; steps: string; result: string; err: string; created: number; started: number | null; finished: number | null }
      | undefined;
  }
  delJob(id: string) { this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id); }

  // ---- ai_runs (Activity: every AI generation the user starts) ----
  addRun(r: { id: string; kind: string; title: string; page: string; platform: string; input: string; steps: string; provider: string; model: string; created: number }) {
    this.db.prepare(`INSERT INTO ai_runs (id, kind, title, page, platform, input, status, steps, provider, model, created) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`)
      .run(r.id, r.kind, r.title, r.page, r.platform, r.input, r.steps, r.provider, r.model, r.created);
    this.db.prepare('DELETE FROM ai_runs WHERE id NOT IN (SELECT id FROM ai_runs ORDER BY created DESC LIMIT 500)').run(); // keep the newest 500
  }
  /** Whitelisted partial update. */
  saveRun(id: string, f: { status?: string; steps?: string; provider?: string; model?: string; output?: string; error?: string; finished?: number; ms?: number }) {
    const cols: string[] = [], vals: any[] = [];
    for (const k of ['status', 'steps', 'provider', 'model', 'output', 'error', 'finished', 'ms'] as const) {
      if (f[k] !== undefined) { cols.push(`${k} = ?`); vals.push(f[k]); }
    }
    if (!cols.length) return;
    vals.push(id);
    this.db.prepare(`UPDATE ai_runs SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
  }
  listRuns(limit = 200): AiRunRow[] {
    return this.db.prepare('SELECT id, kind, title, page, platform, status, steps, provider, model, error, created, finished, ms FROM ai_runs ORDER BY created DESC LIMIT ?').all(limit) as unknown as AiRunRow[];
  }
  getRun(id: string): (AiRunRow & { input: string; output: string }) | undefined {
    return this.db.prepare('SELECT * FROM ai_runs WHERE id = ?').get(id) as unknown as (AiRunRow & { input: string; output: string }) | undefined;
  }
  delRun(id: string) { this.db.prepare('DELETE FROM ai_runs WHERE id = ?').run(id); }
  clearFinishedRuns() { return this.db.prepare("DELETE FROM ai_runs WHERE status != 'running'").run().changes; }
  /** Runs left 'running' by a previous server process can never finish. */
  markOrphanRuns(alive: Set<string>) {
    for (const r of this.db.prepare("SELECT id FROM ai_runs WHERE status = 'running'").all() as { id: string }[]) {
      if (!alive.has(r.id)) this.db.prepare("UPDATE ai_runs SET status = 'interrupted', error = 'server restarted while this was running', finished = ? WHERE id = ?").run(Date.now(), r.id);
    }
  }

  // ---- ad-hoc aggregates for analysis ----
  count(): number { return (this.db.prepare('SELECT COUNT(*) c FROM posts').get() as { c: number }).c; }
  countMeta(): number { return (this.db.prepare('SELECT COUNT(*) c FROM meta').get() as { c: number }).c; }
  sourceStats(sinceMs: number): { source: string; n: number; eng: number }[] {
    return this.db.prepare(
      'SELECT source, COUNT(*) n, COALESCE(SUM(score + comments * 2), 0) eng FROM posts WHERE created > ? GROUP BY source ORDER BY eng DESC'
    ).all(sinceMs) as unknown as { source: string; n: number; eng: number }[];
  }
  securityCount(sinceMs: number): number {
    return (this.db.prepare('SELECT COUNT(*) c FROM posts WHERE created > ? AND security = 1').get(sinceMs) as { c: number }).c;
  }
  volumeWindow(sinceMs: number): number {
    return (this.db.prepare('SELECT COUNT(*) c FROM posts WHERE created > ?').get(sinceMs) as { c: number }).c;
  }
  topicCount(topicJsonMatch: string, sinceMs: number): number {
    return (this.db.prepare('SELECT COUNT(*) c FROM posts WHERE created > ? AND topics LIKE ?').get(sinceMs, topicJsonMatch) as { c: number }).c;
  }
  topEngaged(sinceMs: number, limit: number): { title: string; source: string; link: string; score: number; comments: number }[] {
    return this.db.prepare(
      'SELECT title, source, link, score, comments FROM posts WHERE created > ? ORDER BY score + comments * 2 DESC LIMIT ?'
    ).all(sinceMs, limit) as unknown as { title: string; source: string; link: string; score: number; comments: number }[];
  }
}

const g = globalThis as unknown as { __socialPanelSqlite?: DatabaseSync };

function openRaw(): DatabaseSync {
  const db = new DatabaseSync(DB_FILE);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
      score INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL DEFAULT 0,
      T TEXT NOT NULL DEFAULT '', topics TEXT NOT NULL DEFAULT '[]',
      security INTEGER NOT NULL DEFAULT 0, dev INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS posts_created ON posts(created);
    CREATE TABLE IF NOT EXISTS manual (
      id INTEGER PRIMARY KEY, platform TEXT NOT NULL DEFAULT 'other', text TEXT NOT NULL DEFAULT '',
      eng INTEGER NOT NULL DEFAULT 0, "when" TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, handle TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT 'x', niche TEXT NOT NULL DEFAULT 'dev', notes TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      passHash TEXT NOT NULL,
      created INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user TEXT NOT NULL,
      created INTEGER NOT NULL DEFAULT 0,
      expires INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT 'x',
      status TEXT NOT NULL DEFAULT 'queued', steps TEXT NOT NULL DEFAULT '[]', result TEXT NOT NULL DEFAULT '',
      err TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL DEFAULT 0, started INTEGER, finished INTEGER
    );
    CREATE INDEX IF NOT EXISTS jobs_created ON jobs(created);
    CREATE TABLE IF NOT EXISTS ai_runs (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', page TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '', input TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'running',
      steps TEXT NOT NULL DEFAULT '[]', provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
      output TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
      created INTEGER NOT NULL DEFAULT 0, finished INTEGER, ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS ai_runs_created ON ai_runs(created);
  `);
  try { db.exec('ALTER TABLE posts ADD COLUMN views INTEGER'); } catch {} // legacy DBs get the column lazily (already-existing column throws)
  ensureColumns(db);
  for (const col of ['likes', 'comments', 'views']) {
    try { db.exec(`ALTER TABLE manual ADD COLUMN ${col} INTEGER`); } catch {} // result-logging columns, added lazily on legacy DBs
  }
  return db;
}

/** One-time migration: import a legacy data.json into SQLite when it exists. */
function migrate(db: DatabaseSync) {
  if (db.prepare('SELECT COUNT(*) n FROM meta').get() && db.prepare("SELECT value FROM meta WHERE key = 'schema'").get())
    return; // already migrated/stamped

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
    const setMeta = (k: string, v: unknown) => db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(k, JSON.stringify(v));
    if (raw.lastCollect) setMeta('lastCollect', raw.lastCollect);
    if (raw.lastAI) setMeta('lastAI', raw.lastAI);
    if (raw.lastGoodModel) setMeta('lastGoodModel', raw.lastGoodModel);
    if ((raw.posts || []).length) console.info(`[reticle] migrated ${(raw.posts || []).length} posts from data.json → data.sqlite`);
  } catch { /* no data.json or unreadable — fresh install */ }

  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('schema', JSON.stringify({ v: 1, ts: Date.now() }));
}

/** v2 normalizer columns. Runs once per module load too, so a dev server whose
 *  cached handle predates the columns picks them up on hot reload. */
const POST_COLS_V2: [string, string][] = [['aiCats', 'TEXT'], ['author', 'TEXT'], ['authorFollowers', 'INTEGER'], ['shares', 'INTEGER'], ['saves', 'INTEGER'], ['media', 'TEXT'], ['hashtags', 'TEXT'], ['body', 'TEXT'], ['durationSec', 'INTEGER'], ['authorLocation', 'TEXT']];
function ensureColumns(db: DatabaseSync) {
  const have = new Set((db.prepare('PRAGMA table_info(posts)').all() as { name: string }[]).map(c => c.name));
  for (const [col, type] of POST_COLS_V2) if (!have.has(col)) db.exec(`ALTER TABLE posts ADD COLUMN ${col} ${type}`);
  const jobCols = new Set((db.prepare('PRAGMA table_info(jobs)').all() as { name: string }[]).map(c => c.name));
  if (!jobCols.has('model')) db.exec("ALTER TABLE jobs ADD COLUMN model TEXT NOT NULL DEFAULT ''"); // 'provider|model' or '' = auto
  db.exec(`CREATE TABLE IF NOT EXISTS ai_runs (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', page TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '', input TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'running',
      steps TEXT NOT NULL DEFAULT '[]', provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
      output TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
      created INTEGER NOT NULL DEFAULT 0, finished INTEGER, ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS ai_runs_created ON ai_runs(created);`);
}
let columnsChecked = false;

export function getStore(): SocialDB {
  if (!g.__socialPanelSqlite) {
    const db = openRaw();
    migrate(db);
    g.__socialPanelSqlite = db;
  }
  if (!columnsChecked) { ensureColumns(g.__socialPanelSqlite); columnsChecked = true; }
  return new SocialDB(g.__socialPanelSqlite);
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
      jobs: store.allJobs().length,
      meta: store.countMeta() as number,
    },
  };
}
