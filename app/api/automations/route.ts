import { NextResponse, connection } from 'next/server';
import { listAutomations, saveAutomation, deleteAutomation, setEnabled, runAutomation, isRunning, WORKERS } from '@/lib/automations';
import { cancelRun } from '@/lib/activity';
import { TOOLS } from '@/lib/tools';
import { agentCatalog } from '@/lib/jobs';
import { FORMATS_BY_PLATFORM, FORMAT_PLAYBOOK } from '@/lib/playbook';

/** GET → automations (+ live "running" flag) and the catalog the builder needs. */
export async function GET() {
  await connection();
  const autos = listAutomations().map(a => ({ ...a, running: isRunning(a.id) }));
  return NextResponse.json({
    automations: autos,
    catalog: {
      workers: WORKERS,
      tools: TOOLS.filter(t => !t.visual).map(t => ({ key: t.key, name: t.name, platforms: t.platforms, field: (t.fields.find(f => f.kind !== 'select') || t.fields[0])?.label || 'Input' })),
      agents: agentCatalog().map(a => ({ kind: a.kind, name: a.name, tagline: a.tagline })),
      formats: Object.fromEntries(Object.entries(FORMATS_BY_PLATFORM).map(([p, fs]) => [p, fs.map(f => ({ key: f, label: FORMAT_PLAYBOOK[f].label }))])),
    },
  });
}

/** POST { action: save | delete | toggle | run | cancel, … } */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({} as any));
  try {
    switch (b.action) {
      case 'save': return NextResponse.json({ automation: saveAutomation(b.automation || {}) });
      case 'delete': deleteAutomation(String(b.id)); return NextResponse.json({ ok: true });
      case 'toggle': return NextResponse.json({ automation: setEnabled(String(b.id), !!b.enabled) });
      case 'run': {
        const id = String(b.id);
        if (isRunning(id)) return NextResponse.json({ error: 'already running' }, { status: 409 });
        void runAutomation(id, 'manual'); // runs in the background; follow it on Activity
        return NextResponse.json({ ok: true });
      }
      case 'cancel': return NextResponse.json({ ok: cancelRun(String(b.runId)) });
      default: return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 });
  }
}
