import { NextResponse, connection } from 'next/server';
import { viralBrief } from '@/lib/application/viral';
import { route } from '@/lib/http/route';

/**
 * GET — the brief for one viral post: what it did and why it worked, ready to
 * hand to the generator. The original wording is deliberately left out — only
 * the structure travels.
 *
 *   ?postId=x:123
 */
const handler_GET = async (req: Request) => {
  await connection(); // request-time: SQLite reads are sync, so without this Next prerenders & caches the response
  const postId = new URL(req.url).searchParams.get('postId') || '';
  if (!postId) return NextResponse.json({ error: 'postId is required' }, { status: 400 });
  const brief = viralBrief(postId);
  if (!brief) return NextResponse.json({ error: 'That post is not in the corpus' }, { status: 404 });
  // the wording never leaves through this door — only the structure does
  return NextResponse.json({ ...brief, card: { ...brief.card, body: '' } });
};

export const GET = route(handler_GET);
