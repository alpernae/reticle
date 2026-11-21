import { NextResponse } from 'next/server';
import { jobAction, deleteJob } from '@/lib/jobs';
import { route } from '@/lib/http/route';

/** POST /api/jobs/[id] — body { action: 'pause' | 'resume' | 'stop' }. */
const handler_POST = async (req: Request, _user: string, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const res = jobAction(id, String(body.action || ''));
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/jobs/[id] — stops it if still running, then removes the row. */
const handler_DELETE = async (_req: Request, _user: string, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  deleteJob(id);
  return NextResponse.json({ ok: true });
}

export const POST = route(handler_POST);
export const DELETE = route(handler_DELETE);
