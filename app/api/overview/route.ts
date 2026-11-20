// GET /api/overview — the Overview page's read model (ADR-004).
//
// The page asks for a platform, a category and a search term; the server
// buckets the corpus into days and answers with the aggregates. No post ever
// leaves the server unless a page asks for it by name.
import { NextResponse, connection } from 'next/server';
import { buildOverview } from '@/lib/application/overview';
import { route } from '@/lib/http/route';

const handler_GET = async (req: Request) => {
  await connection(); // request-time: SQLite reads are sync, so without this Next prerenders & caches the response
  const u = new URL(req.url);
  return NextResponse.json(buildOverview({
    platform: u.searchParams.get('platform') || '',
    category: u.searchParams.get('category') || '',
    q: u.searchParams.get('q') || '',
  }));
};

export const GET = route(handler_GET);
