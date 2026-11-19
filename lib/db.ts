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
export type AiRunRow = {
  id: string; kind: string; title: string; page: string; platform: string; status: string; steps: string;
  provider: string; model: string; error: string; created: number; finished: number | null; ms: number | null;
};
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

/** Depth of the current transaction on this connection (SQLite has one). */
let txDepth = 0;

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

  // ---- jobs (async agent runs) ----
  addJob(j: { id: string; kind: string; topic: string; platform: string; steps: string; created: number; model?: string }) {
    this.prep('INSERT INTO jobs (id, kind, topic, platform, status, steps, result, err, created, started, finished, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
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
    this.prep(`UPDATE jobs SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
  }
  allJobs(): { id: string; kind: string; topic: string; platform: string; status: string; steps: string; result: string; err: string; created: number; started: number | null; finished: number | null }[] {
    return this.prep('SELECT * FROM jobs ORDER BY created DESC LIMIT 100').all() as unknown as { id: string; kind: string; topic: string; platform: string; status: string; steps: string; result: string; err: string; created: number; started: number | null; finished: number | null }[];
  }
  getJobRow(id: string) {
    return this.prep('SELECT * FROM jobs WHERE id = ?').get(id) as
      | { id: string; kind: string; topic: string; platform: string; status: string; steps: string; result: string; err: string; created: number; started: number | null; finished: number | null }
      | undefined;
  }
  delJob(id: string) { this.prep('DELETE FROM jobs WHERE id = ?').run(id); }

  // ---- ai_runs (Activity: every AI generation the user starts) ----
  addRun(r: { id: string; kind: string; title: string; page: string; platform: string; input: string; steps: string; provider: string; model: string; created: number }) {
    this.prep(`INSERT INTO ai_runs (id, kind, title, page, platform, input, status, steps, provider, model, created) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`)
      .run(r.id, r.kind, r.title, r.page, r.platform, r.input, r.steps, r.provider, r.model, r.created);
    this.prep('DELETE FROM ai_runs WHERE id NOT IN (SELECT id FROM ai_runs ORDER BY created DESC LIMIT 500)').run(); // keep the newest 500
  }
  /** Whitelisted partial update. */
  saveRun(id: string, f: { status?: string; steps?: string; provider?: string; model?: string; output?: string; error?: string; finished?: number; ms?: number }) {
    const cols: string[] = [], vals: any[] = [];
    for (const k of ['status', 'steps', 'provider', 'model', 'output', 'error', 'finished', 'ms'] as const) {
      if (f[k] !== undefined) { cols.push(`${k} = ?`); vals.push(f[k]); }
    }
    if (!cols.length) return;
    vals.push(id);
    this.prep(`UPDATE ai_runs SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
  }
  listRuns(limit = 200): AiRunRow[] {
    return this.prep('SELECT id, kind, title, page, platform, status, steps, provider, model, error, created, finished, ms FROM ai_runs ORDER BY created DESC LIMIT ?').all(limit) as unknown as AiRunRow[];
  }
  getRun(id: string): (AiRunRow & { input: string; output: string }) | undefined {
    return this.prep('SELECT * FROM ai_runs WHERE id = ?').get(id) as unknown as (AiRunRow & { input: string; output: string }) | undefined;
  }
  delRun(id: string) { this.prep('DELETE FROM ai_runs WHERE id = ?').run(id); }
  clearFinishedRuns() { return this.prep("DELETE FROM ai_runs WHERE status != 'running'").run().changes; }
  /** Runs left 'running' by a previous server process can never finish. */
  markOrphanRuns(alive: Set<string>) {
    for (const r of this.prep("SELECT id FROM ai_runs WHERE status = 'running'").all() as { id: string }[]) {
      if (!alive.has(r.id)) this.prep("UPDATE ai_runs SET status = 'interrupted', error = 'server restarted while this was running', finished = ? WHERE id = ?").run(Date.now(), r.id);
    }
  }

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
      jobs: store.allJobs().length,
      meta: store.countMeta() as number,
    },
  };
}
