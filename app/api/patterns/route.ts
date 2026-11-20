// GET /api/patterns — outlier winners + the pattern library (deterministic, no AI).
//
// The numbers come from the materialized read model (ADR-004): the per-post
// facts and the breakout scores are columns, so no re-analysis happens here.
import { NextResponse, connection } from 'next/server';
import { buildPatterns } from '@/lib/application/patterns';
import { route } from '@/lib/http/route';

const handler_GET = async (req: Request) => {
  await connection();
  const u = new URL(req.url);
  return NextResponse.json(buildPatterns({
    platform: u.searchParams.get('platform') || '',
    niche: u.searchParams.get('niche') === '1',
    cat: u.searchParams.get('cat') || '',
  }));
};

export const GET = route(handler_GET);
