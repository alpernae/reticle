'use client';
// Mind maps — your own thinking space, on a PanelUI Flow canvas.
// Drag ideas around, connect them by dragging from a dot on a node's side,
// double-click to rename, Delete to remove. Each idea has a kind (idea, post,
// question, task) and a note. "Expand with AI" grows the selected branch,
// "Write a post" sends the branch to Generate. Everything autosaves.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHead, btn, btnPrimary, inputCls } from '@/components/panel';
import { Empty } from '@/components/kit';
import { Flow } from '@/components/panelui/flow';
import { ModelPicker, pickedModel } from '@/components/model-picker';
import { Sel } from '@/components/sel';
import { Spinner } from '@/components/panelui/spinner';
import { toast } from '@/components/toaster';
import { notifyActivity } from '@/components/panel';
import { CheckSquare, CircleHelp, GitBranchPlus, Lightbulb, ListTree, PenLine, Plus, Sparkles, Square, Trash2, Unlink, Wand2 } from 'lucide-react';

type Kind = 'root' | 'idea' | 'post' | 'question' | 'task';
type MNode = { id: string; text: string; x: number; y: number; kind: Kind; note?: string; done?: boolean };
type MEdge = { id: string; from: string; to: string };
type MindMap = { id: string; title: string; nodes: MNode[]; edges: MEdge[]; updated: number };
type MapInfo = { id: string; title: string; nodes: number; updated: number };

const KINDS: { key: Exclude<Kind, 'root'>; label: string; icon: typeof Lightbulb }[] = [
  { key: 'idea', label: 'Idea', icon: Lightbulb }, { key: 'post', label: 'Post idea', icon: PenLine },
  { key: 'question', label: 'Question', icon: CircleHelp }, { key: 'task', label: 'Task', icon: CheckSquare },
];
const TEMPLATES = [
  { key: 'blank', label: 'Blank map' }, { key: 'pillars', label: 'Content pillars' },
  { key: 'launch', label: 'App launch plan' }, { key: 'post', label: 'Plan one post' },
];
const uid = () => 'n' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
const COL = 300, ROW = 96;

export default function MindMaps() {
  const router = useRouter();
  const [maps, setMaps] = useState<MapInfo[] | null>(null);
  const [map, setMap] = useState<MindMap | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState<'saved' | 'saving' | 'idle'>('idle');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [layoutRev, setLayoutRev] = useState(0);
  const dirty = useRef(false);

  const loadList = useCallback(async () => {
    const j = await fetch('/api/mindmaps').then(r => r.json()).catch(() => ({ maps: [] }));
    setMaps(j.maps || []);
    return (j.maps || []) as MapInfo[];
  }, []);
  const open = useCallback(async (id: string) => {
    const j = await fetch('/api/mindmaps?id=' + encodeURIComponent(id)).then(r => r.json()).catch(() => null);
    if (j?.map) { setMap(j.map); setSel(null); setEditing(null); localStorage.setItem('payload.mindmap', id); }
  }, []);
  useEffect(() => {
    loadList().then(list => {
      const want = new URLSearchParams(location.search).get('id') || localStorage.getItem('payload.mindmap');
      const pick = list.find(m => m.id === want) || list[0];
      if (pick) open(pick.id);
    });
  }, [loadList, open]);

  // autosave, 700ms after the last change
  useEffect(() => {
    if (!map || !dirty.current) return;
    setSaved('saving');
    const t = setTimeout(async () => {
      dirty.current = false;
      await fetch('/api/mindmaps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'save', map }) }).catch(() => {});
      setSaved('saved');
      setMaps(ms => ms?.map(m => (m.id === map.id ? { ...m, title: map.title, nodes: map.nodes.length, updated: Date.now() } : m)) || ms);
    }, 700);
    return () => clearTimeout(t);
  }, [map]);
  const change = (fn: (m: MindMap) => MindMap) => { dirty.current = true; setMap(m => (m ? fn(m) : m)); };

  const create = async (template: string) => {
    const j = await fetch('/api/mindmaps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create', template }) }).then(r => r.json());
    if (j.map) { await loadList(); setMap(j.map); setSel('root'); localStorage.setItem('payload.mindmap', j.map.id); }
  };
  const removeMap = async () => {
    if (!map || !confirm(`Delete the map "${map.title}"? This can't be undone.`)) return;
    await fetch('/api/mindmaps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: map.id }) });
    const list = await loadList();
    setMap(null);
    if (list[0]) open(list[0].id);
  };

  const node = map?.nodes.find(n => n.id === sel) || null;
  const parentOf = useCallback((id: string) => map?.edges.find(e => e.to === id)?.from, [map]);
  const childrenOf = useCallback((id: string) => (map?.edges.filter(e => e.from === id).map(e => e.to) || []), [map]);
  const pathTo = (id: string): string[] => {
    const out: string[] = []; let cur: string | undefined = id; const seen = new Set<string>();
    while (cur && !seen.has(cur)) { seen.add(cur); const n = map?.nodes.find(x => x.id === cur); if (n) out.unshift(n.text); cur = parentOf(cur); }
    return out;
  };

  /** where a new child of `pid` goes: one column right, below its last child */
  const childSpot = (m: MindMap, pid: string, i = 0) => {
    const p = m.nodes.find(n => n.id === pid)!;
    const kids = m.edges.filter(e => e.from === pid).map(e => m.nodes.find(n => n.id === e.to)!).filter(Boolean);
    const y = kids.length ? Math.max(...kids.map(k => k.y)) + ROW * (i + 1) : p.y + ROW * i;
    return { x: p.x + COL, y };
  };
  const addChild = (pid = sel || 'root', text = 'New idea', kind: Kind = 'idea') => {
    if (!map) return;
    const id = uid();
    change(m => ({ ...m, nodes: [...m.nodes, { id, text, kind, ...childSpot(m, pid) }], edges: [...m.edges, { id: `${pid}-${id}`, from: pid, to: id }] }));
    setSel(id); setEditing(id);
  };
  const addSibling = () => {
    const pid = sel ? parentOf(sel) : undefined;
    if (pid) addChild(pid); else addChild('root');
  };
  const removeNode = (id: string) => {
    if (!map || map.nodes.find(n => n.id === id)?.kind === 'root') return;
    // remove the node and everything that hangs only from it
    const gone = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of map.edges) if (gone.has(e.from) && !gone.has(e.to) && !map.edges.some(o => o.to === e.to && !gone.has(o.from))) { gone.add(e.to); grew = true; }
    }
    change(m => ({ ...m, nodes: m.nodes.filter(n => !gone.has(n.id)), edges: m.edges.filter(e => !gone.has(e.from) && !gone.has(e.to)) }));
    setSel(null);
  };
  const patchNode = (id: string, p: Partial<MNode>) => change(m => ({ ...m, nodes: m.nodes.map(n => (n.id === id ? { ...n, ...p } : n)) }));

  /** tidy tree layout from the root (unattached ideas go underneath) */
  const tidy = () => {
    if (!map) return;
    const pos: Record<string, { x: number; y: number }> = {};
    let row = 0;
    const seen = new Set<string>();
    const walk = (id: string, depth: number): number => {
      seen.add(id);
      const kids = childrenOf(id).filter(k => !seen.has(k));
      if (!kids.length) { pos[id] = { x: depth * COL, y: row++ * ROW }; return pos[id].y; }
      const ys = kids.map(k => walk(k, depth + 1));
      pos[id] = { x: depth * COL, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
      return pos[id].y;
    };
    walk('root', 0);
    for (const n of map.nodes) if (!seen.has(n.id)) walk(n.id, 0);
    change(m => ({ ...m, nodes: m.nodes.map(n => ({ ...n, ...(pos[n.id] || {}) })) }));
    setLayoutRev(v => v + 1);
  };

  const expand = async () => {
    if (!map || !sel) return;
    setBusy(true);
    notifyActivity();
    const existing = childrenOf(sel).map(id => map.nodes.find(n => n.id === id)?.text || '');
    const j = await fetch('/api/mindmaps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'expand', path: pathTo(sel), existing, count: 5, model: pickedModel(model) }) }).then(r => r.json()).catch(e => ({ error: e.message }));
    setBusy(false);
    if (!j.ideas?.length) { toast('Could not expand this idea', { description: j.error || 'No ideas came back', type: 'destructive' }); return; }
    const pid = sel;
    change(m => {
      let mm = m;
      j.ideas.forEach((it: { text: string; kind: Kind }, i: number) => {
        const id = uid() + i;
        const spot = childSpot(mm, pid, 0);
        mm = { ...mm, nodes: [...mm.nodes, { id, text: it.text, kind: it.kind, ...spot }], edges: [...mm.edges, { id: `${pid}-${id}`, from: pid, to: id }] };
      });
      return mm;
    });
    toast(`Added ${j.ideas.length} ideas`, { description: 'Use Tidy to re-arrange the map', type: 'success' });
  };

  const writePost = () => {
    if (!map || !sel) return;
    const path = pathTo(sel);
    const kids = childrenOf(sel).map(id => map.nodes.find(n => n.id === id)?.text).filter(Boolean);
    const text = [
      `From my mind map "${map.title}": ${path.join(' → ')}`,
      node?.note ? `Notes: ${node.note}` : '',
      kids.length ? `Points to cover: ${kids.join('; ')}` : '',
    ].filter(Boolean).join('\n');
    try { sessionStorage.setItem('sc-studio-brief', JSON.stringify({ from: 'Mind map', topic: '', text })); } catch {}
    router.push('/generate');
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of map?.nodes || []) c[n.kind] = (c[n.kind] || 0) + 1;
    return c;
  }, [map]);

  return (
    <div className="space-y-4">
      <PageHead title="Mind maps" sub="Your own thinking space: map content pillars, plan a launch, or break one post into points. Grow a branch with AI and turn any idea into a post."
        right={<div className="flex items-center gap-2">
          <Sel aria-label="New map from template" value="" onChange={e => e.target.value && create(e.target.value)} size="sm" className="w-48">
            <option value="">+ New map…</option>
            {TEMPLATES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </Sel>
        </div>} />

      {maps === null ? <div className="py-20 text-center text-sm text-muted-foreground">Loading…</div>
        : !maps.length || !map ? (
          <div className="rounded-xl border border-border bg-card">
            <Empty title="No mind maps yet">Start from a template:</Empty>
            <div className="-mt-8 flex flex-wrap justify-center gap-2 pb-12">
              {TEMPLATES.map(t => <button key={t.key} onClick={() => create(t.key)} className={btn + ' h-8 px-3 text-xs'}><Plus className="size-3.5" aria-hidden="true" />{t.label}</button>)}
            </div>
          </div>
        ) : (
          <>
            {/* map bar: switch · rename · actions on the selection */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
              <Sel aria-label="Open map" value={map.id} onChange={e => open(e.target.value)} size="sm" className="w-52">
                {maps.map(m => <option key={m.id} value={m.id}>{m.title} · {m.nodes}</option>)}
              </Sel>
              <input value={map.title} onChange={e => change(m => ({ ...m, title: e.target.value }))} aria-label="Map title"
                className="h-8 w-56 rounded-lg border border-transparent bg-transparent px-2 text-sm font-medium outline-none hover:border-border focus:border-foreground/40" />
              <span className="text-[11px] text-muted-foreground">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved' : ''}</span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <button onClick={() => addChild()} className={btn + ' h-8 px-3 text-xs'} title="Add a child idea to the selected one (or to the centre)"><GitBranchPlus className="size-3.5" aria-hidden="true" /> Child</button>
                <button onClick={addSibling} className={btn + ' h-8 px-3 text-xs'} disabled={!sel} title="Add an idea next to the selected one"><Plus className="size-3.5" aria-hidden="true" /> Sibling</button>
                <button onClick={tidy} className={btn + ' h-8 px-3 text-xs'} title="Arrange the map as a tidy tree"><ListTree className="size-3.5" aria-hidden="true" /> Tidy</button>
                <button onClick={removeMap} className={btn + ' h-8 px-2.5'} title="Delete this map" aria-label="Delete this map"><Trash2 className="size-3.5" aria-hidden="true" /></button>
              </div>
            </div>

            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
              <Flow key={`${map.id}-${layoutRev}`} className="h-[calc(100vh-290px)] min-h-[440px] rounded-xl" fitViewOnMount fitViewPadding={60} minZoom={0.2} label={`Mind map: ${map.title}`}
                onNodeDragEnd={(id, p) => patchNode(id, { x: Math.round(p.x), y: Math.round(p.y) })}
                onConnect={c => change(m => (m.edges.some(e => e.from === c.source && e.to === c.target) ? m : { ...m, edges: [...m.edges, { id: `${c.source}-${c.target}`, from: c.source, to: c.target }] }))}>
                <Flow.Background variant="dots" />
                {map.nodes.map(n => (
                  <MapNode key={n.id} n={n} selected={sel === n.id} editing={editing === n.id}
                    onPress={() => { setSel(n.id); if (sel === n.id) setEditing(n.id); }}
                    onDelete={() => removeNode(n.id)}
                    onEdit={() => { setSel(n.id); setEditing(n.id); }}
                    onText={t => patchNode(n.id, { text: t })}
                    onDone={() => setEditing(null)}
                    onToggle={() => patchNode(n.id, { done: !n.done })} />
                ))}
                {map.edges.map(e => <Flow.Edge key={e.id} from={e.from} to={e.to} variant="bezier" color={sel && (e.from === sel || e.to === sel) ? 'primary' : undefined} />)}
                <Flow.Controls position="bottom-left" />
                <Flow.MiniMap position="bottom-right" />
              </Flow>

              {/* inspector */}
              <aside className="space-y-4 rounded-xl border border-border bg-card p-4">
                {!node ? (
                  <div className="space-y-3 text-[13px] text-muted-foreground">
                    <p className="font-medium text-foreground">How it works</p>
                    <ul className="list-disc space-y-1 pl-4">
                      <li>Click an idea to select it, click again (or double-click) to rename.</li>
                      <li>Drag ideas to move them; drag from a dot on a side to connect two.</li>
                      <li><b>Child</b> adds a branch, <b>Delete</b> removes the selected idea.</li>
                      <li><b>Expand with AI</b> suggests 5 ideas for the selected branch.</li>
                    </ul>
                    <div className="flex flex-wrap gap-1.5 pt-1 text-[11px]">
                      {KINDS.map(k => <span key={k.key} className="rounded-md bg-muted px-1.5 py-0.5">{k.label}s {counts[k.key] || 0}</span>)}
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground" htmlFor="mm-text">Idea</label>
                      <textarea id="mm-text" rows={2} value={node.text} onChange={e => patchNode(node.id, { text: e.target.value })} className={inputCls + ' resize-none'} />
                    </div>
                    {node.kind !== 'root' && (
                      <div>
                        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Kind</div>
                        <div className="grid grid-cols-2 gap-1">
                          {KINDS.map(k => (
                            <button key={k.key} onClick={() => patchNode(node.id, { kind: k.key })}
                              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[12px] ${node.kind === k.key ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                              <k.icon className="size-3.5" aria-hidden="true" />{k.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground" htmlFor="mm-note">Note</label>
                      <textarea id="mm-note" rows={4} value={node.note || ''} onChange={e => patchNode(node.id, { note: e.target.value })} placeholder="Details, links, a rough draft…" className={inputCls + ' resize-y text-[13px]'} />
                    </div>

                    <div className="space-y-2 border-t border-border pt-4">
                      <ModelPicker value={model} onChange={setModel} compact label="AI for Expand" />
                      <button onClick={expand} disabled={busy} className={btnPrimary + ' w-full justify-center'}>
                        {busy ? <Spinner className="size-4" /> : <Wand2 className="size-4" aria-hidden="true" />} {busy ? 'Thinking…' : 'Expand with AI'}
                      </button>
                      <button onClick={writePost} className={btn + ' w-full justify-center'}><Sparkles className="size-4" aria-hidden="true" /> Write a post from this</button>
                    </div>

                    {node.kind !== 'root' && (
                      <div className="flex gap-1.5 border-t border-border pt-4">
                        {parentOf(node.id) && (
                          <button onClick={() => change(m => ({ ...m, edges: m.edges.filter(e => e.to !== node.id) }))} className={btn + ' h-8 flex-1 justify-center px-2 text-xs'} title="Remove the link to its parent">
                            <Unlink className="size-3.5" aria-hidden="true" /> Detach
                          </button>
                        )}
                        <button onClick={() => removeNode(node.id)} className={btn + ' h-8 flex-1 justify-center px-2 text-xs'}><Trash2 className="size-3.5" aria-hidden="true" /> Delete</button>
                      </div>
                    )}
                  </>
                )}
              </aside>
            </div>
          </>
        )}
    </div>
  );
}

function MapNode({ n, selected, editing, onPress, onDelete, onEdit, onText, onDone, onToggle }: {
  n: MNode; selected: boolean; editing: boolean;
  onPress: () => void; onDelete: () => void; onEdit: () => void; onText: (t: string) => void; onDone: () => void; onToggle: () => void;
}) {
  const root = n.kind === 'root';
  const K = KINDS.find(k => k.key === n.kind);
  return (
    <Flow.Node id={n.id} position={{ x: n.x, y: n.y }} selected={selected} onPress={onPress} onDelete={root ? undefined : onDelete}
      onDoubleClick={onEdit}
      className={`${root ? 'min-w-48 bg-foreground text-background' : 'min-w-40'} max-w-64 ${n.done ? 'opacity-60' : ''}`}>
      <Flow.Handle position="left" />
      <div className={`flex items-start gap-2 px-3.5 ${root ? 'py-3' : 'py-2.5'}`}>
        {n.kind === 'task'
          ? <button onClick={onToggle} aria-label={n.done ? 'Mark not done' : 'Mark done'} className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground">{n.done ? <CheckSquare className="size-4" /> : <Square className="size-4" />}</button>
          : K && <K.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        {editing ? (
          <input autoFocus defaultValue={n.text} aria-label="Idea text"
            onChange={e => onText(e.target.value)} onBlur={onDone}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
            className={`w-full min-w-0 bg-transparent text-[13px] outline-none ${root ? 'font-semibold' : 'font-medium'}`} />
        ) : (
          <span className={`min-w-0 break-words text-[13px] leading-snug ${root ? 'text-[15px] font-semibold' : 'font-medium'} ${n.done ? 'line-through' : ''}`}>{n.text || 'Untitled'}</span>
        )}
      </div>
      {n.note && !root && <div className="border-t border-border px-3.5 py-1.5 text-[11px] text-muted-foreground line-clamp-2">{n.note}</div>}
      <Flow.Handle position="right" />
    </Flow.Node>
  );
}
