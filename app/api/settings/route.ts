import { NextResponse, connection } from 'next/server';
import { dbStats } from '@/lib/db';
import { readApifyStatus } from '@/lib/apify';
import { saveTimezone, timezoneInfo } from '@/lib/timezone-store';

/** GET — everything the Settings page renders: local SQLite facts, Apify
 *  connection state and the time zone schedules run in. Read-only; the token
 *  itself is written through POST /api/apify and stored only in the meta table. */
export async function GET() {
  await connection(); // request-time: SQLite reads are sync, so without this Next prerenders & caches the response
  return NextResponse.json({ db: dbStats(), apify: readApifyStatus(), timezone: timezoneInfo() });
}

/** POST { timezone } — '' clears the override and follows the server default. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as { timezone?: string }));
  try {
    saveTimezone(String(body?.timezone ?? ''));
    return NextResponse.json({ timezone: timezoneInfo() });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 });
  }
}
