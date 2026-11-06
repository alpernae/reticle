import { NextResponse, connection } from 'next/server';
import { getStore } from '@/lib/db';
import { readModelStatus } from '@/lib/ai';
import { spendInfo } from '@/lib/apify';

/**
 * GET → AI usage as Reticle itself records it (the sidebar Usage widget):
 *   today's runs by provider vs a soft daily budget, 7-day success rate and
 *   speed, OpenCode models out of quota, and Apify collector spend.
 * Claude plan limits (5-hour / weekly) are not readable with a setup token,
 * so they are not shown.
 */
const LABEL: Record<string, string> = { 'claude-cli': 'Claude CLI', anthropic: 'Claude API', opencode: 'OpenCode' };

export async function GET() {
  await connection();
  const store = getStore();
  const runs = store.listRuns(1000);
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const today = runs.filter(r => r.created >= dayStart.getTime());
  const week = runs.filter(r => r.created >= Date.now() - 7 * 864e5);

  const byProvider: Record<string, number> = {};
  for (const r of today) {
    const k = r.provider ? (LABEL[r.provider] || r.provider) : r.status === 'running' ? 'Running' : 'No provider';
    byProvider[k] = (byProvider[k] || 0) + 1;
  }
  const finished = week.filter(r => r.status !== 'running');
  const done = finished.filter(r => r.status === 'done');
  const times = done.map(r => r.ms || 0).filter(Boolean).sort((a, b) => a - b);

  const status = readModelStatus();
  const oc = Object.entries(status).filter(([k]) => k.startsWith('opencode|'));
  const limited = oc.filter(([, v]) => !v.ok && v.retryAt && v.retryAt > Date.now());
  const soonest = limited.map(([, v]) => v.retryAt!).sort((a, b) => a - b)[0] ?? null;

  const budgetRaw = Number(store.getMeta('aiDailyRunBudget'));
  const spend = await spendInfo().catch(() => null);

  return NextResponse.json({
    today: { total: today.length, budget: budgetRaw > 0 ? budgetRaw : 100, segments: Object.entries(byProvider).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value) },
    week: { runs: week.length, finished: finished.length, done: done.length, failed: finished.filter(r => r.status === 'failed').length, medianMs: times.length ? times[times.length >> 1] : null },
    opencode: { tracked: oc.length, limited: limited.length, soonestReset: soonest },
    apify: spend && (spend.spend != null || spend.limit > 0) ? { spend: spend.spend, limit: spend.limit, via: spend.via } : null,
  });
}
