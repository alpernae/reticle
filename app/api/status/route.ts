// GET /api/status — how the app is doing (ADR-004, phase 4e).
//
// One round trip: the database, the task worker, the analytics read model,
// the AI providers and the backups. It is the first thing to look at when
// something feels off — and the payload an uptime check would read.
//
// Behind the session like every other route: it says how the app is doing,
// not what is in it. (The open liveness check is GET /api/health.)
import { NextResponse, connection } from 'next/server';
import { health } from '@/lib/application/health';
import { route } from '@/lib/http/route';

const handler_GET = async () => {
  await connection();
  // always 200: the app is up. What is off (a stale snapshot, no backup yet)
  // is in `problems` — a stale read model is not an outage.
  return NextResponse.json(health());
};

export const GET = route(handler_GET);
