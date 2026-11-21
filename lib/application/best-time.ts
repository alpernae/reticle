// lib/application/best-time.ts — the timing points for the Best-time card.
//
// The card ranks posting windows by how much the posts that went out then
// beat their creator's normal. It needs one small fact per post — when it
// went out, and its breakout score — and nothing else. Both live in the
// derived columns now (ADR-004), so this is an indexed read.
import 'server-only';
import { getStore } from '../db';

export type TimingPoint = { s: string; t: number; o: number };

/** The timing points, optionally narrowed to one platform. */
export function bestTimePoints(platform = ''): { points: TimingPoint[] } {
  const rows = getStore().outlierRows();
  const points: TimingPoint[] = [];
  for (const r of rows) {
    if (platform && platform !== 'all' && r.source !== platform) continue;
    points.push({ s: r.source, t: r.created, o: r.outlier });
  }
  return { points };
}
