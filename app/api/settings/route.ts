import { NextResponse, connection } from 'next/server';
import { dbStats } from '@/lib/db';
import { readApifyStatus } from '@/lib/apify';

/** GET — everything the Settings page renders: local SQLite facts + Apify
 *  connection state. Read-only; the token itself is written through
 *  POST /api/apify and stored only in the meta table. */
export async function GET() {
  await connection(); // request-time: SQLite reads are sync, so without this Next prerenders & caches the response
  return NextResponse.json({ db: dbStats(), apify: readApifyStatus() });
}
