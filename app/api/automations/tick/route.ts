import { NextResponse } from 'next/server';
import { runDue, schedulerKey } from '@/lib/automations';

/** POST — the server's own scheduler (lib/startup.ts) calls this every 30s.
 *  The proxy only lets it through with the scheduler key (or a signed-in session). */
export async function POST(req: Request) {
  const key = req.headers.get('x-payload-scheduler');
  if (key && key !== schedulerKey()) return NextResponse.json({ error: 'bad key' }, { status: 403 });
  return NextResponse.json({ started: runDue() });
}
