// lib/application/topics.ts — the topic list for the pickers.
//
// Two pages (Generate and Studio) offer the classifier's topics as a
// dropdown. The list comes from the materialized snapshot when it is current
// and is computed otherwise (ADR-004).
import 'server-only';
import { currentSnapshot } from '../analytics-read';
import { topicSpikes } from '../engine';
import type { TopicSpike } from '../analytics-read';

export function topicList(): { topics: TopicSpike[] } {
  const snap = currentSnapshot();
  return { topics: snap ? snap.payload.topicSpikes : topicSpikes() };
}
