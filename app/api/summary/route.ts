// GET /api/summary — the few numbers every page shows (ADR-004).
//
// The top bar carries a post count and the AI health chip; the Generate page
// wants the AI health on its own. This replaced the old /api/state, which
// answered with the entire corpus.
import { NextResponse, connection } from 'next/server';
import { getStore } from '@/lib/db';
import { readState } from '@/lib/app-state';
import { aiHealth } from '@/lib/ai';
import { route } from '@/lib/http/route';

const handler_GET = async () => {
  await connection();
  const store = getStore();
  return NextResponse.json({
    count: store.count(),
    manualCount: store.countManual(),
    aiHealth: aiHealth(),
    lastCollect: readState<any>('lastCollect', null),
    lastAI: readState<any>('lastAI', null),
    lastAnalysis: readState<any>('lastAnalysis', null),
  });
};

export const GET = route(handler_GET);
