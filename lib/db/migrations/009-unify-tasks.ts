// Migration 009 — one task table (ADR-001, final unification).
//
// The old Activity log (`ai_runs`) and the Studio jobs (`jobs`) become tasks:
// every row is copied over once — steps, provider, result and timestamps
// included — and the old tables are dropped. Nothing is lost: the Activity
// page keeps showing the same history, now read from one table.
import type { DatabaseSync } from 'node:sqlite';

export const version = 9;
export const name = 'unify-tasks';

function tableExists(db: DatabaseSync, name: string): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

const parse = (text: string | null | undefined): any => {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
};

/** The old statuses → the task statuses. A run that was 'running' when the
 *  app stopped is dead work: it becomes a failed task with a clear error. */
function oldStatus(status: string): { status: string; error: string | null } {
  switch (status) {
    case 'done': return { status: 'done', error: null };
    case 'failed': return { status: 'failed', error: null };
    case 'cancelled':
    case 'stopped': return { status: 'cancelled', error: null };
    case 'interrupted':
    case 'running': return { status: 'failed', error: 'interrupted — the server was restarted' };
    default: return { status: 'queued', error: null };
  }
}

export function up(db: DatabaseSync) {
  const insTask = db.prepare(`INSERT OR REPLACE INTO tasks
    (id, kind, parent_id, status, input, output, error, checkpoint, provider, model,
     attempts, max_attempts, run_after, lease_until, cancel_requested, title, page, platform, trigger, created, started, finished)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insEvent = db.prepare(`INSERT OR REPLACE INTO task_events (task_id, seq, at, type, label, state, data) VALUES (?, ?, ?, ?, ?, ?, ?)`);

  // ---- the Activity log (ai_runs) ----
  if (tableExists(db, 'ai_runs')) {
    const rows = db.prepare('SELECT * FROM ai_runs').all() as any[];
    for (const r of rows) {
      const st = oldStatus(String(r.status || 'running'));
      const created = Number(r.created) || 0;
      insTask.run(
        r.id, String(r.kind || 'generate'), null, st.status,
        String(r.input || '{}'), r.output ? String(r.output) : null, String(r.error || '') || st.error, null,
        String(r.provider || ''), String(r.model || ''),
        1, 1, created, null, st.status === 'cancelled' ? 1 : 0,
        String(r.title || r.kind || 'run').slice(0, 160), String(r.page || ''), String(r.platform || ''), 'legacy',
        created, created, r.finished ?? null,
      );
      const steps = parse(r.steps);
      if (Array.isArray(steps)) {
        steps.forEach((s: any, i: number) => {
          if (!s || typeof s !== 'object') return;
          insEvent.run(r.id, i + 1, Number(s.at) || created, 'step', String(s.label || '').slice(0, 300), String(s.state || 'active').slice(0, 30), null);
        });
      }
    }
  }

  // ---- the Studio jobs ----
  if (tableExists(db, 'jobs')) {
    const rows = db.prepare('SELECT * FROM jobs').all() as any[];
    for (const r of rows) {
      const st = oldStatus(String(r.status || 'queued'));
      const created = Number(r.created) || 0;
      const model = String(r.model || '');
      const cut = model.indexOf('|');
      const providerID = cut > 0 ? model.slice(0, cut) : '';
      const modelId = cut > 0 ? model.slice(cut + 1) : '';
      const input = {
        kind: String(r.kind || ''), topic: String(r.topic || ''), platform: String(r.platform || 'x'),
        model: model ? { providerID, id: modelId } : null,
      };
      insTask.run(
        r.id, 'workflow', null, st.status,
        JSON.stringify(input), JSON.stringify({ result: String(r.result || '') }), String(r.err || '') || st.error, null,
        providerID, modelId,
        1, 1, created, null, st.status === 'cancelled' ? 1 : 0,
        `Workflow · ${input.kind}${input.topic ? ` — ${input.topic}` : ''}`.slice(0, 160), '/workflows', input.platform, 'legacy',
        created, r.started ?? null, r.finished ?? null,
      );
      const steps = parse(r.steps);
      if (Array.isArray(steps)) {
        steps.forEach((s: any, i: number) => {
          if (!s || typeof s !== 'object') return;
          const data = { name: s.name ?? '', note: s.note ?? '', dur: s.dur ?? null };
          insEvent.run(r.id, i + 1, Number(s.at) || Number(r.started) || created, 'step', String(s.label || '').slice(0, 300), String(s.state || 'pending').slice(0, 30), JSON.stringify(data));
        });
      }
    }
  }

  db.exec('DROP TABLE IF EXISTS ai_runs; DROP TABLE IF EXISTS jobs;');
}
