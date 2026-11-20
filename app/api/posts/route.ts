// GET /api/posts — the Feed page's read model (ADR-004).
//
// The filters, the sort and the pagination happen on the server: the browser
// asks for one page of rows at a time and gets the stats for the whole
// filtered set alongside them.
import { NextResponse, connection } from 'next/server';
import { listPosts } from '@/lib/application/posts';
import { route } from '@/lib/http/route';

const handler_GET = async (req: Request) => {
  await connection(); // request-time: SQLite reads are sync, so without this Next prerenders & caches the response
  const u = new URL(req.url);
  return NextResponse.json(listPosts({
    platform: u.searchParams.get('platform') || '',
    topic: u.searchParams.get('topic') || '',
    security: u.searchParams.get('security') === '1',
    q: u.searchParams.get('q') || '',
    sort: u.searchParams.get('sort') || 'new',
    cursor: u.searchParams.get('cursor') || '',
    limit: Number(u.searchParams.get('limit') || 100),
  }));
};

export const GET = route(handler_GET);
