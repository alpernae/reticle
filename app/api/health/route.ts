// GET /api/health — is the app up?
//
// The Docker HEALTHCHECK cannot sign in, so this endpoint is deliberately
// open and deliberately small: it says whether the app answers, whether the
// database answers and how long the process has been up. Nothing about the
// corpus — the full picture (counts, file path, providers, backups) is
// GET /api/status, behind the session.
//
// This is the only open route besides /api/auth and /login.
import { NextResponse, connection } from 'next/server';
import { getStore } from '@/lib/db';
import { workerStatus } from '@/lib/runtime/worker';

const handler_GET = async () => {
  await connection();
  let db: 'ok' | 'error' = 'error';
  try {
    getStore().db.prepare('SELECT 1').get();
    db = 'ok';
  } catch { /* the database is not answering */ }
  const worker = workerStatus();
  return NextResponse.json({
    ok: db === 'ok',
    db,
    uptimeMs: Date.now() - worker.bootAt,
    tasksRunning: worker.running,
  });
};

// exported without the session wrapper on purpose — see the note above
export const GET = handler_GET;
