// lib/mindmaps.ts — your own mind maps (stored as JSON in SQLite meta).
// A map is nodes (text, position, kind, optional note) and edges between them.
// "Expand with AI" asks the model for child ideas of one node, given the path
// from the root, so a branch grows in context.
import 'server-only';
import { getStore } from './db';

export type MNodeKind = 'root' | 'idea' | 'post' | 'question' | 'task';
export type MNode = { id: string; text: string; x: number; y: number; kind: MNodeKind; note?: string; done?: boolean };
export type MEdge = { id: string; from: string; to: string };
export type MindMap = { id: string; title: string; nodes: MNode[]; edges: MEdge[]; created: number; updated: number };

const KEY = 'mindmaps';
export function listMaps(): MindMap[] {
  try { const v = JSON.parse(getStore().getMeta(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function saveAll(maps: MindMap[]) { getStore().setMeta(KEY, JSON.stringify(maps)); }

const KINDS: MNodeKind[] = ['root', 'idea', 'post', 'question', 'task'];
export function saveMap(m: Partial<MindMap>): MindMap {
  const maps = listMaps();
  const now = Date.now();
  const old = m.id ? maps.find(x => x.id === m.id) : undefined;
  const nodes: MNode[] = (m.nodes || old?.nodes || []).slice(0, 400).map(n => ({
    id: String(n.id).slice(0, 40), text: String(n.text ?? '').slice(0, 300),
    x: Math.round(Number(n.x) || 0), y: Math.round(Number(n.y) || 0),
    kind: KINDS.includes(n.kind) ? n.kind : 'idea',
    ...(n.note ? { note: String(n.note).slice(0, 2000) } : {}), ...(n.done ? { done: true } : {}),
  }));
  const ids = new Set(nodes.map(n => n.id));
  const edges: MEdge[] = (m.edges || old?.edges || []).filter(e => ids.has(e.from) && ids.has(e.to) && e.from !== e.to).slice(0, 800)
    .map(e => ({ id: String(e.id || `${e.from}-${e.to}`).slice(0, 90), from: e.from, to: e.to }));
  const map: MindMap = {
    id: old?.id || 'map' + now.toString(36),
    title: String(m.title ?? old?.title ?? 'Untitled map').slice(0, 80) || 'Untitled map',
    nodes, edges, created: old?.created || now, updated: now,
  };
  saveAll(old ? maps.map(x => (x.id === map.id ? map : x)) : [map, ...maps]);
  return map;
}
export function deleteMap(id: string) { saveAll(listMaps().filter(m => m.id !== id)); }

/** Ready-made starting points. */
export function templateMap(kind: string): Partial<MindMap> {
  const T: Record<string, { title: string; root: string; kids: [string, MNodeKind][] }> = {
    blank: { title: 'New map', root: 'Central idea', kids: [] },
    pillars: { title: 'Content pillars', root: 'My content', kids: [['Bug bounty stories', 'idea'], ['Mobile app security', 'idea'], ['Building my app in public', 'idea'], ['Tools I use', 'idea']] },
    launch: { title: 'App launch plan', root: 'Launch my app', kids: [['Before: build the audience', 'task'], ['Launch week posts', 'post'], ['Where to post it', 'question'], ['After: what to measure', 'task']] },
    post: { title: 'Plan one post', root: 'The post idea', kids: [['Hook', 'idea'], ['The one point', 'idea'], ['Proof / example', 'idea'], ['Ending question', 'question']] },
  };
  const t = T[kind] || T.blank;
  const nodes: MNode[] = [{ id: 'root', text: t.root, x: 0, y: 0, kind: 'root' }];
  const edges: MEdge[] = [];
  t.kids.forEach(([text, k], i) => {
    const id = 'n' + i;
    nodes.push({ id, text, kind: k, x: 320, y: (i - (t.kids.length - 1) / 2) * 110 });
    edges.push({ id: 'root-' + id, from: 'root', to: id });
  });
  return { title: t.title, nodes, edges };
}
