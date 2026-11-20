// /api/backup — the database backups.
//
// GET  → the copies on disk (newest first)
// POST → back up now, as a task (the Settings page's button)
//
// The nightly backup runs on its own; this endpoint is the manual way to take
// one before something risky happens.
import { NextResponse, connection } from 'next/server';
import { listBackups } from '@/lib/backup';
import { backupNow } from '@/lib/application/backup';
import { runTaskAndReply } from '@/lib/http/task-shim';
import { route } from '@/lib/http/route';

const handler_GET = async () => {
  await connection();
  return NextResponse.json({ backups: listBackups() });
};

const handler_POST = async () => {
  await connection();
  return runTaskAndReply({
    kind: 'backup',
    input: { manual: true },
    title: 'Database backup',
    page: '/settings',
    trigger: 'api',
  }, 120_000);
};

export const GET = route(handler_GET);
export const POST = route(handler_POST);
