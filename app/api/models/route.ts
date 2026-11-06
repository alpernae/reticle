import { NextResponse, connection } from 'next/server';
import { Service } from '@opencode/client/service';
import { opencodeCommand } from '@/lib/opencodeai';

/** Lists models available through the local OpenCode service + the configured default. */
export async function GET() {
  await connection(); // request-time: SQLite reads are sync, so without this Next prerenders & caches the response
  try {
    const command = opencodeCommand(); // native exe on Windows — the .cmd shim can't be spawned without a shell
    const endpoint = await Service.ensure(command ? { command } : undefined);
    const headers = Service.headers(endpoint) as Record<string, string>;
    const fetchJson = (p: string) => fetch(endpoint.url + p, { headers, signal: AbortSignal.timeout(8000) }).then(r => r.json());
    const [list, def] = await Promise.all([fetchJson('/api/model'), fetchJson('/api/model/default')]);
    // Normalize shapes defensively — server may return {providerID, id} or {providerID, modelID}
    const models: { providerID: string; id: string; label: string }[] = [];
    for (const m of (Array.isArray(list) ? list : list?.models || list?.data || [])) {
      const providerID = m.providerID || m?.model?.providerID || '';
      const id = m.id || m.modelID || '';
      if (!providerID || !id) continue;
      models.push({ providerID, id, label: `${providerID}/${id}` });
    }
    const d: any = def?.data || def || {};
    const defaultModel = { providerID: d.providerID || 'opencode', id: d.id || d.modelID || '' };
    // de-dupe
    const seen = new Set<string>();
    const uniq = models.filter(m => !seen.has(m.label) && seen.add(m.label));
    return NextResponse.json({ models: uniq, defaultModel });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
