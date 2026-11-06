import { NextResponse, connection } from 'next/server';
import { jobsList, createJob, agentCatalog } from '@/lib/jobs';

/** GET /api/jobs — run list with live step states (Studio polls this). */
export async function GET() {
  await connection(); // request-time: SQLite reads are sync, so without this Next prerenders & caches the response
  return NextResponse.json({ jobs: jobsList(), catalog: agentCatalog() });
}

/** POST /api/jobs — launch an agent. Returns immediately; the runner works in background. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const res = createJob({ kind: body.kind, topic: body.topic, platform: body.platform, model: body.model || null });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true, id: res.id });
}
