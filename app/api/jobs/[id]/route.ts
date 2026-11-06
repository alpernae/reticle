import { NextResponse } from 'next/server';
import { jobAction, deleteJob } from '@/lib/jobs';

/** POST /api/jobs/[id] — body { action: 'pause' | 'resume' | 'stop' }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const res = jobAction(id, String(body.action || ''));
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/jobs/[id] — stops it if still running, then removes the row. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteJob(id);
  return NextResponse.json({ ok: true });
}
