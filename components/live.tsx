'use client';
// The live event stream — one SSE connection per tab, shared by every listener.
//
// The shell used to poll `/api/activity?summary=1` every four seconds for the
// running-count badges and the finish toasts. Now the server pushes the same
// summary over `/api/events` whenever it changes, and a slow poll stays as a
// safety net for the cases where a proxy blocks the stream.
//
// Nothing here is required for the app to work: if the stream never connects,
// the poll carries the updates.
import { useEffect } from 'react';

export type LiveSummary = {
  running: number;
  active?: string[];
  recent?: { id: string; kind: string; page?: string | null; title: string; status: string; error?: string | null; ms?: number | null }[];
};

type Listener = (s: LiveSummary) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** The last summary we delivered — the poll skips when nothing changed. */
let lastJson = '';

const deliver = (s: LiveSummary) => {
  if (!s || typeof s.running !== 'number') return;
  const json = JSON.stringify(s);
  if (json === lastJson) return;
  lastJson = json;
  listeners.forEach(l => l(s));
};

const poll = () => fetch('/api/activity?summary=1').then(r => r.json()).then(deliver).catch(() => {});

const startPoll = () => {
  if (pollTimer) return;
  poll();
  pollTimer = setInterval(poll, 15_000); // the safety net, not the fast path
};

const stopPoll = () => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
};

const connect = () => {
  if (source || typeof EventSource === 'undefined') return;
  try {
    const es = new EventSource('/api/events');
    es.addEventListener('activity', (e) => {
      try { deliver(JSON.parse((e as MessageEvent).data)); } catch { /* a broken frame */ }
    });
    es.onopen = () => { stopPoll(); };
    es.onerror = () => {
      // the browser retries on its own; until it succeeds, the poll carries
      startPoll();
    };
    source = es;
  } catch {
    startPoll();
  }
};

const disconnect = () => {
  if (source) { source.close(); source = null; }
  stopPoll();
};

/** Listen for activity changes. Returns the unsubscribe function. */
export function subscribeActivity(fn: Listener): () => void {
  listeners.add(fn);
  if (!source) connect();
  // the first paint should not wait for the stream
  poll();
  return () => {
    listeners.delete(fn);
    if (!listeners.size) disconnect();
  };
}

/** Ask for a refresh right away (after the user starts something). */
export const pokeActivity = () => setTimeout(poll, 400);

/** React helper: run a callback whenever the activity changes. */
export function useLiveActivity(fn: Listener) {
  useEffect(() => subscribeActivity(fn), [fn]);
}
