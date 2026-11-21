import { NextResponse, connection } from 'next/server';
import { dbStats } from '@/lib/db';
import { readApifyStatus } from '@/lib/apify';
import { saveTimezone, timezoneInfo } from '@/lib/timezone-store';
import { route } from '@/lib/http/route';

/** GET — everything the Settings page renders: local SQLite facts, Apify
 *  connection state and the time zone schedules run in. Read-only; the token
 *  itself is written through POST /api/apify and stored only in the meta table. */
const handler_GET = async () => {
  await connection(); // request-time: SQLite reads are sync, so without this Next prerenders & caches the response
  return NextResponse.json({ db: dbStats(), apify: readApifyStatus(), timezone: timezoneInfo() });
}

/** POST { timezone } — '' clears the override and follows the server default. */
const handler_POST = async (req: Request) => {
  const body = await req.json().catch(() => ({} as { timezone?: string }));
  try {
    saveTimezone(String(body?.timezone ?? ''));
    return NextResponse.json({ timezone: timezoneInfo() });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 });
  }
}

export const GET = route(handler_GET);
export const POST = route(handler_POST);
