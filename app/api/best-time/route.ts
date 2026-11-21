// GET /api/best-time — the timing points for the Best-time card (ADR-004).
//
// One small fact per post: when it went out and how far it beat its
// creator's normal. Both are materialized columns now.
import { NextResponse, connection } from 'next/server';
import { bestTimePoints } from '@/lib/application/best-time';
import { route } from '@/lib/http/route';

const handler_GET = async (req: Request) => {
  await connection();
  const u = new URL(req.url);
  return NextResponse.json(bestTimePoints(u.searchParams.get('platform') || ''));
};

export const GET = route(handler_GET);
