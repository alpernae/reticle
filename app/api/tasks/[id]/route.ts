// app/api/tasks/[id]/route.ts — one task: read it (with its step log), wait
// for it, or control it (cancel / pause / resume / retry).
import { NextResponse } from 'next/server';
import {
  cancelTask, deleteTask, getTask, getTaskEvents, pauseTask, resumeTask, retryTask, waitForTask,
} from '@/lib/application/tasks';
import { route } from '@/lib/http/route';

const handler_GET = async (req: Request, _user: string, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const wait = Number(new URL(req.url).searchParams.get('wait') || 0);
  const task = wait > 0 ? await waitForTask(id, wait) : getTask(id);
  if (!task) return NextResponse.json({ error: 'task not found' }, { status: 404 });
  return NextResponse.json({ task, events: getTaskEvents(id) });
}

const handler_POST = async (req: Request, _user: string, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({} as any));
  const action = String(body?.action || '');
  const fn = action === 'cancel' ? cancelTask : action === 'pause' ? pauseTask : action === 'resume' ? resumeTask : action === 'retry' ? retryTask : null;
  if (!fn) return NextResponse.json({ error: 'action must be cancel, pause, resume or retry' }, { status: 400 });
  if (!fn(id)) return NextResponse.json({ error: `cannot ${action} this task` }, { status: 409 });
  return NextResponse.json({ ok: true, task: getTask(id) });
}

const handler_DELETE = async (_req: Request, _user: string, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!deleteTask(id)) return NextResponse.json({ error: 'task not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export const GET = route(handler_GET);
export const POST = route(handler_POST);
export const DELETE = route(handler_DELETE);
