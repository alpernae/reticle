import { NextResponse, connection } from 'next/server';
import { getStore } from '@/lib/db';
import { readApifyStatus, setApifyToken, clearApifyToken, verifyToken, saveConfig, setBudget, pollActiveRuns, reimportRuns, spendInfo, actorPricing, X_DEEP_ACTOR, type ApifyConfig } from '@/lib/apify';

/** GET — connection + config + run history. Polls any still-active (or stuck)
 *  runs first, so a collector finishes importing even if the Sources page was
 *  closed mid-run. */
export async function GET() {
  await connection(); // request-time: SQLite reads are sync, so without this Next prerenders & caches the response
  try { await pollActiveRuns(); } catch { /* status is still returned */ }
  const st = readApifyStatus();
  const [spend, ...prices] = await Promise.all([spendInfo(), ...Object.values(st.config).map(c => actorPricing(c.actor)), actorPricing(X_DEEP_ACTOR)]);
  const keys = Object.keys(st.config);
  const pricing: Record<string, unknown> = Object.fromEntries(keys.map((k, i) => [k, prices[i]]));
  pricing['x-scan'] = prices[keys.length];
  const counts = Object.fromEntries(getStore().sourceStats(0).map(r => [r.source, r.n]));
  return NextResponse.json({ ...st, spend, pricing, counts });
}

/** POST { action: 'save', token } | { action: 'clear' } | { action: 'config', config }.
 *  The token is verified against Apify BEFORE being stored, and stored ONLY in
 *  the local SQLite meta table — it never leaves this machine except to
 *  api.apify.com itself. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const action = body?.action;

  if (action === 'clear') {
    clearApifyToken();
    return NextResponse.json(readApifyStatus());
  }

  if (action === 'config') {
    try {
      const config = saveConfig(body.config as ApifyConfig);
      return NextResponse.json({ ...readApifyStatus(), config });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
  }

  if (action === 'reimport') {
    try { return NextResponse.json({ ...readApifyStatus(), reimport: await reimportRuns() }); }
    catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
  }

  if (action === 'budget') {
    // { budgetUsd: number } — 0 disables the limit. Stored locally in meta only.
    setBudget(Number(body?.budgetUsd));
    return NextResponse.json(readApifyStatus());
  }

  const token = String(body?.token || '').trim();
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });
  const v = await verifyToken(token);
  if (!v.ok) return NextResponse.json({ ...readApifyStatus(), error: 'Apify rejected that token: ' + (v.error || 'unknown') }, { status: 400 });
  setApifyToken(token);
  return NextResponse.json({ ...readApifyStatus(), verifiedAs: v.username });
}
