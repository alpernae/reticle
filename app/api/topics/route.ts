// GET /api/topics — the classifier's topics with their 48-hour movement.
//
// The Generate and Studio pages offer them as a dropdown; the list comes
// from the materialized snapshot when it is current (ADR-004).
import { NextResponse, connection } from 'next/server';
import { topicList } from '@/lib/application/topics';
import { route } from '@/lib/http/route';

const handler_GET = async () => {
  await connection();
  return NextResponse.json(topicList());
};

export const GET = route(handler_GET);
