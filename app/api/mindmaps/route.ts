// app/api/mindmaps/route.ts — HTTP adapter for the mind maps.
//
// GET → map list; GET ?id= → one full map
// POST { action: create | save | delete | expand }
//
// "expand" is a durable task (kind "mindmap"): the route enqueues it and waits
// for the worker to write the branch's ideas.
import { NextResponse } from 'next/server';
import { listMaps, saveMap, deleteMap, templateMap, type MindMap } from '@/lib/mindmaps';
import { runTaskAndReply } from '@/lib/http/task-shim';
import { route } from '@/lib/http/route';

/** GET → map list; GET ?id= → one full map */
const handler_GET = async (req: Request) => {
  const id = new URL(req.url).searchParams.get('id');
  const maps = listMaps();
  if (id) {
    const m = maps.find(x => x.id === id);
    return m ? NextResponse.json({ map: m }) : NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ maps: maps.map(m => ({ id: m.id, title: m.title, nodes: m.nodes.length, updated: m.updated })) });
}

/** POST { action: create | save | delete | expand } */
const handler_POST = async (req: Request) => {
  const b = await req.json().catch(() => ({} as any));
  if (b.action === 'create') return NextResponse.json({ map: saveMap(templateMap(String(b.template || 'blank'))) });
  if (b.action === 'save') return NextResponse.json({ map: saveMap(b.map as MindMap) });
  if (b.action === 'delete') { deleteMap(String(b.id)); return NextResponse.json({ ok: true }); }
  if (b.action === 'expand') {
    const path: string[] = (Array.isArray(b.path) ? b.path : []).map((s: unknown) => String(s).slice(0, 200)).slice(0, 8);
    const last = path[path.length - 1] || 'idea';
    return runTaskAndReply({
      kind: 'mindmap',
      input: { path, existing: b.existing, count: b.count, model: b.model || null },
      title: `Mind map: expand "${last.slice(0, 60)}"`,
      page: '/mindmaps',
      trigger: 'api',
    }, 175_000);
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

export const GET = route(handler_GET);
export const POST = route(handler_POST);
