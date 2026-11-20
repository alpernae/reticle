import { NextResponse, connection } from 'next/server';
import { allPayload } from '@/lib/engine';
import { aiHealth } from '@/lib/ai';
import { route } from '@/lib/http/route';

const handler_GET = async () => {
  await connection(); // request-time: SQLite reads are sync, so without this Next prerenders & caches the response
  // aiHealth = per-provider status (one failing model no longer turns the whole app "AI off")
  return NextResponse.json({ ...allPayload(), aiHealth: aiHealth() });
}

export const GET = route(handler_GET);
