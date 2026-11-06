import { NextResponse } from 'next/server';
import { listMaps, saveMap, deleteMap, templateMap, type MindMap } from '@/lib/mindmaps';
import { smartAI } from '@/lib/aichain';
import { tracked, RunCancelled } from '@/lib/activity';

/** GET → map list; GET ?id= → one full map */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  const maps = listMaps();
  if (id) {
    const m = maps.find(x => x.id === id);
    return m ? NextResponse.json({ map: m }) : NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ maps: maps.map(m => ({ id: m.id, title: m.title, nodes: m.nodes.length, updated: m.updated })) });
}

/** POST { action: create | save | delete | expand } */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({} as any));
  try {
    if (b.action === 'create') return NextResponse.json({ map: saveMap(templateMap(String(b.template || 'blank'))) });
    if (b.action === 'save') return NextResponse.json({ map: saveMap(b.map as MindMap) });
    if (b.action === 'delete') { deleteMap(String(b.id)); return NextResponse.json({ ok: true }); }
    if (b.action === 'expand') {
      // the path from the centre to the node keeps the ideas on the branch's subject
      const path: string[] = (Array.isArray(b.path) ? b.path : []).map((s: unknown) => String(s).slice(0, 200)).slice(0, 8);
      const existing: string[] = (Array.isArray(b.existing) ? b.existing : []).map((s: unknown) => String(s).slice(0, 120)).slice(0, 20);
      const n = Math.min(8, Math.max(2, Number(b.count) || 5));
      const model = b.model?.providerID && b.model?.id ? b.model : null;
      const last = path[path.length - 1] || 'idea';
      const out = await tracked({ kind: 'mindmap', title: `Mind map: expand "${last.slice(0, 60)}"`, page: '/mindmaps', input: { path: path.join(' → '), count: n }, model }, async run => {
        run.step('Asking for ideas');
        const r = await smartAI([
          'I am brainstorming in a mind map. The branch I am on, from the centre outwards:',
          path.map((p, i) => `${'  '.repeat(i)}- ${p}`).join('\n'),
          existing.length ? `Already under it (do not repeat these): ${existing.join(' | ')}` : '',
          `Give exactly ${n} new child ideas for the LAST item. Each short (at most 9 words), concrete, specific to me as a creator, and different from each other.`,
          'Output one per line and nothing else. You may start a line with "Q:" for a question to answer, "POST:" for a ready post idea, or "TODO:" for an action.',
        ].filter(Boolean).join('\n'), 120_000, model, run.signal, { role: 'ideas' });
        run.via(r.model);
        if (!r.out) throw new Error(r.errors.join(' | ') || 'no answer');
        const ideas = r.out.split('\n')
          .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0, n)
          .map(l => {
            const m = /^(Q|POST|TODO)\s*:\s*/i.exec(l);
            const tag = m?.[1].toUpperCase();
            const kind = tag === 'Q' ? 'question' : tag === 'POST' ? 'post' : tag === 'TODO' ? 'task' : 'idea';
            return { text: l.replace(/^(Q|POST|TODO)\s*:\s*/i, '').replace(/^["“]|["”]$/g, '').slice(0, 120), kind };
          });
        return { ideas };
      });
      return NextResponse.json(out);
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e instanceof RunCancelled ? 'cancelled' : String(e?.message || e) }, { status: e instanceof RunCancelled ? 499 : 400 });
  }
}
