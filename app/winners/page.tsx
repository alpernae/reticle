'use client';
// Winners — two sections now:
//   1. SUGGESTED POSTS: top ranked winners turned into ready-to-copy draft
//      templates (x · linkedin · instagram) with the full detail line the user
//      asked for: impressions, likes, comments, views, posted date incl. hour.
//   2. MY RESULTS: every result Generate produced (AI or manual/template) is
//      stored here automatically. After posting, log the real numbers
//      (views/likes/comments/date) on the row — those feed the analysis.
import Link from 'next/link';
import { useApiState, Card, CardHead, Chip, PageHead, btn, btnPrimary, inputCls, labelCls, kfmt } from '@/components/panel';
import { Copy, Check, ExternalLink, Lightbulb, ChevronDown, ChevronRight, Trash2, ClipboardPaste } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Spinner } from '@/components/panelui/spinner';

const selCls = inputCls;
const PLAT: Record<string, string> = { x: 'X / Twitter', linkedin: 'LinkedIn', instagram: 'Instagram' };

type Suggestion = {
  id: string; kind: 'own' | 'public'; origin: string; target: string;
  title: string; draft: string; hashtags: string[]; link: string | null;
  whenLabel: string; likes: number | null; comments: number | null; views: number | null;
  eng: number; engDetail: string; detailLine: string; topics: string[]; scorePct: number;
};

const fmtWhen = (w: string) => {
  const t = Date.parse(w);
  return isNaN(t) ? w : new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export default function Winners() {
  const { data: d, reload } = useApiState();
  const [target, setTarget] = useState('x');
  const [sugs, setSugs] = useState<Suggestion[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);   // expanding a result row to log stats
  const [copied, setCopied] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<number, { when: string; likes: string; comments: string; views: string }>>({});
  const [saving, setSaving] = useState<number | null>(null);

  const loadSgs = useCallback(async (t: string) => {
    setSugs(null);
    try {
      const j = await fetch(`/api/suggest?platform=${t}`).then(r => r.json());
      setSugs(j.suggestions || []);
    } catch { setSugs([]); }
  }, []);
  useEffect(() => { loadSgs(target); }, [target, loadSgs]);

  const copy = (text: string, key: string) => { navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1800); };

  const sendToGenerate = (s: Suggestion) => {
    try {
      sessionStorage.setItem('sc-studio-brief', JSON.stringify({
        from: 'Winners',
        topic: s.topics[0] || '',
        text: `SUGGESTED ${PLAT[s.target] || s.target} post (from ${s.origin || s.kind === 'own' ? 'your results' : s.origin}):\n${s.title}\n\nWhy it worked: ${s.detailLine}\n\nDraft skeleton to fill:\n${s.draft}`,
      }));
    } catch {}
    location.href = '/generate';
  };

  const logResult = async (m: any) => {
    const e = edit[m.id]; if (!e) return;
    setSaving(m.id);
    await fetch('/api/manual', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'm:' + m.id, when: e.when || m.when, likes: e.likes === '' ? null : Number(e.likes), comments: e.comments === '' ? null : Number(e.comments), views: e.views === '' ? null : Number(e.views) }),
    });
    setSaving(null); setOpen(null); reload();
  };
  const del = async (id: number) => {
    await fetch('/api/manual?id=m:' + id, { method: 'DELETE' });
    reload();
  };

  const results = d?.manual || [];
  const draftBtn = (text: string, key: string) => (
    <button onClick={() => copy(text, key)} className={btn + ' h-8 px-3 text-xs'} aria-label="copy draft">
      {copied === key ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      {copied === key ? 'Copied' : 'Copy'}
    </button>
  );

  return (
    <div className="space-y-4">
      <PageHead
        title="Winners"
        sub="Suggested posts ready to copy — with impressions, likes, comments, views and the full posted date incl. hour. Every result Generate produces lands here; log the real numbers after posting."
        right={<Chip tone="a">{results.length} stored results</Chip>}
      />

      {/* ---- 1. suggested posts ---- */}
      <Card>
        <CardHead
          title="Suggested posts"
          sub="top ranked winners, reshaped as a copyable draft for the chosen platform — deterministic templates, no AI call"
          right={
            <div className="flex gap-1.5">
              {['x', 'linkedin', 'instagram'].map(t => (
                <button key={t} onClick={() => setTarget(t)} aria-pressed={target === t}
                  className={`h-8 rounded-lg px-3 text-[13px] font-medium border transition-colors ${target === t ? 'bg-primary text-primary-foreground border-transparent' : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
                  {PLAT[t]}
                </button>
              ))}
            </div>
          }
        />
        <div className="space-y-3 px-5 pb-5 pt-4">
          {sugs === null && <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Spinner className="size-4" /> Shaping suggestions…</div>}
          {sugs?.length === 0 && <div className="py-6 text-sm text-muted-foreground">No suggestions yet — run the collectors on Sources and log results here.</div>}
          {(sugs || []).map((s: Suggestion) => (
            <div key={s.id} className="rounded-lg border border-border px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={s.kind === 'own' ? 'g' : 'z'}>{s.kind === 'own' ? 'your result' : 'public winner'}</Chip>
                <Chip tone="a">{PLAT[s.origin] || s.origin}</Chip>
                <span className="text-xs text-muted-foreground">{s.whenLabel}</span>
                {s.link && <Link href={s.link} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="open original"> <ExternalLink className="size-3.5" aria-hidden="true" /></Link>}
              </div>
              <p className="mt-2 text-[14px] font-medium leading-snug">{s.title}</p>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/60 px-3 py-2.5 text-[13px] leading-relaxed">{s.draft}</pre>
              {s.hashtags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">{s.hashtags.map((h: string) => <Chip key={h} tone="z">{h}</Chip>)}</div>
              )}
              <p className="mt-2 font-mono text-[12px] text-muted-foreground">{s.detailLine}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {draftBtn(s.draft, 's' + s.id)}
                {draftBtn(s.detailLine, 'd' + s.id)}
                <button onClick={() => sendToGenerate(s)} className={btnPrimary + ' h-8 px-3 text-xs'} aria-label="send suggestion to Generate"><Lightbulb className="size-3.5" aria-hidden="true" /> Polish with AI</button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ---- 2. my stored results ---- */}
      <Card>
        <CardHead
          title="My results"
          sub="generate outputs (AI and template) save here automatically — after posting, log the real numbers: impressions, likes, comments, full date with hour"
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2 font-medium">when</th><th className="px-2 py-2 font-medium">platform</th>
                <th className="px-2 py-2 font-medium">eng</th><th className="px-2 py-2 font-medium">impr.</th>
                <th className="px-2 py-2 font-medium">likes</th><th className="px-2 py-2 font-medium">comments</th>
                <th className="px-3 py-2 font-medium">text</th><th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {results.map((m: any) => {
                const isOpen = open === m.id;
                const e = edit[m.id] || { when: m.when ? m.when.slice(0, 16) : '', likes: m.likes != null ? String(m.likes) : '', comments: m.comments != null ? String(m.comments) : '', views: m.views != null ? String(m.views) : '' };
                return (
                  <tr key={m.id} className="border-b border-border align-top">
                    <td className="px-5 py-2.5 text-xs whitespace-nowrap">{m.when ? fmtWhen(m.when) : 'not posted yet'}</td>
                    <td className="px-2 py-2.5"><Chip tone="z">{PLAT[m.platform] || m.platform}</Chip></td>
                    <td className="px-2 py-2.5 tabular-nums">{m.eng ? kfmt(m.eng) : '—'}</td>
                    <td className="px-2 py-2.5 tabular-nums">{m.views != null ? kfmt(m.views) : '—'}</td>
                    <td className="px-2 py-2.5 tabular-nums">{m.likes != null ? kfmt(m.likes) : '—'}</td>
                    <td className="px-2 py-2.5 tabular-nums">{m.comments != null ? kfmt(m.comments) : '—'}</td>
                    <td className="px-3 py-2.5 text-[13px] whitespace-pre-line max-w-[280px]">{(m.text || '').slice(0, 160)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setOpen(isOpen ? null : m.id)} className={`${btn} h-8 px-2.5 text-xs`} aria-label="log result">
                        {isOpen ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}
                        Log result
                      </button>
                      <button onClick={() => del(m.id)} className={`${btn} h-8 px-2 text-xs text-muted-foreground hover:text-foreground ml-1`} aria-label="delete result"><Trash2 className="size-3.5" aria-hidden="true" /></button>
                    </td>
                    {isOpen && (
                      <td className="border-t border-border bg-muted/40" colSpan={8}>
                        <div className="flex flex-wrap items-end gap-3 px-5 py-3">
                          <div>
                            <label className={labelCls} htmlFor={`when-${m.id}`}>Posted at (full date + hour)</label>
                            <input id={`when-${m.id}`} type="datetime-local" className={selCls} value={e.when} onChange={ev => setEdit(x => ({ ...x, [m.id]: { ...e, when: ev.target.value } }))} />
                          </div>
                          <div className="w-24">
                            <label className={labelCls} htmlFor={`views-${m.id}`}>Impressions</label>
                            <input id={`views-${m.id}`} type="number" min={0} className={selCls} placeholder="views" value={e.views} onChange={ev => setEdit(x => ({ ...x, [m.id]: { ...e, views: ev.target.value } }))} />
                          </div>
                          <div className="w-24">
                            <label className={labelCls} htmlFor={`likes-${m.id}`}>Likes</label>
                            <input id={`likes-${m.id}`} type="number" min={0} className={selCls} placeholder="likes" value={e.likes} onChange={ev => setEdit(x => ({ ...x, [m.id]: { ...e, likes: ev.target.value } }))} />
                          </div>
                          <div className="w-24">
                            <label className={labelCls} htmlFor={`comments-${m.id}`}>Comments</label>
                            <input id={`comments-${m.id}`} type="number" min={0} className={selCls} placeholder="comments" value={e.comments} onChange={ev => setEdit(x => ({ ...x, [m.id]: { ...e, comments: ev.target.value } }))} />
                          </div>
                          <button onClick={() => logResult(m)} disabled={saving === m.id} className={btnPrimary + ' h-9 px-3'}>
                            {saving === m.id ? <Spinner className="size-4" /> : <ClipboardPaste className="size-4" aria-hidden="true" />}
                            {saving === m.id ? 'Saving…' : 'Save numbers'}
                          </button>
                          <p className="w-full text-[11px] text-muted-foreground">
                            eng auto-computes from the numbers: likes + 2×comments. Leave a field empty to log nothing for it.
                          </p>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!results.length && (
                <tr><td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  Nothing stored yet — hit <b className="text-foreground">Generate</b> and every variant lands here. Then run the collectors on Sources to power the suggested posts above.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
