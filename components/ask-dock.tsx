'use client';
// Ask — a PanelUI Command Dock, floating at the bottom-right corner. Press it (or "/" when
// not typing), ask anything about your data ("which hooks work on Threads?",
// "best time for LinkedIn?"), and the answer arrives a line at a time,
// followed by the collected posts that match. Answers use only your data and
// are recorded on Activity.
import { useEffect, useRef, useState } from 'react';
import { CommandDock } from '@/components/panelui/command-dock';
import { rememberedModel } from '@/components/model-picker';
import { SNAME } from '@/components/kit';
import { BRAND } from '@/lib/brand';
import { ArrowUpRight, MessageCircleQuestion, CircleAlert } from 'lucide-react';

type Post = { id: string; title: string; source: string; author: string | null; outlier: number; likes: number; link: string };
type Row = { id: string; kind: 'line' | 'post' | 'error' | 'hint'; text: string; post?: Post };

const SUGGESTIONS = ['Which hooks work best on Threads?', 'When should I post on LinkedIn?', 'What topics are rising this week?'];

export function AskDock() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  // "/" opens it when you are not typing somewhere else
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault(); setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (open && !rows.length && !busy) setRows(SUGGESTIONS.map((s, i) => ({ id: 'h' + i, kind: 'hint', text: s }))); }, [open, rows.length, busy]);
  useEffect(() => clearTimers, []);

  /** add rows one by one, so the answer reads as being written */
  const reveal = (list: Row[]) => {
    clearTimers();
    setRows([]);
    list.forEach((r, i) => timers.current.push(setTimeout(() => setRows(prev => [...prev, r]), 140 * i)));
  };

  const ask = async (q: string) => {
    const question = q.trim();
    if (question.length < 3 || busy) return;
    setValue(question);
    clearTimers(); setRows([]); setBusy(true);
    const j = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: question, model: rememberedModel() }) })
      .then(r => r.json()).catch(e => ({ error: e.message }));
    setBusy(false);
    const lines: Row[] = j.answer
      ? String(j.answer).split('\n').map((s: string) => s.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean).slice(0, 8).map((s: string, i: number) => ({ id: 'l' + i, kind: 'line' as const, text: s }))
      : [{ id: 'e', kind: 'error', text: j.error || 'No answer came back. Check Settings → AI providers.' }];
    const posts: Row[] = (j.posts || []).slice(0, 4).map((p: Post) => ({ id: 'p' + p.id, kind: 'post' as const, text: p.title, post: p }));
    reveal([...lines, ...posts]);
  };

  return (
    <CommandDock className="pointer-events-none justify-end! [&>*]:pointer-events-auto [&>*]:shadow-lg" open={open} onOpenChange={o => { setOpen(o); if (!o) { clearTimers(); setRows([]); setValue(''); } }}
      value={value} onValueChange={setValue} onSubmit={ask} busy={busy} closedWidth="10.5rem">
      <CommandDock.Trigger>
        <MessageCircleQuestion aria-hidden="true" /> Ask {BRAND.name}
        <kbd className="ml-1 rounded border border-border bg-muted px-1 text-[10px] font-medium text-muted-foreground">/</kbd>
      </CommandDock.Trigger>
      <CommandDock.Panel>
        <CommandDock.Input placeholder="Ask about your posts, hooks, timing…" submitLabel="Ask" />
        <CommandDock.Results label="Answer">
          {rows.map(r => r.kind === 'post' && r.post ? (
            <CommandDock.Row key={r.id} onSelect={() => window.open(r.post!.link, '_blank', 'noopener,noreferrer')}>
              <ArrowUpRight aria-hidden="true" />
              <CommandDock.RowTitle>{r.text}</CommandDock.RowTitle>
              <CommandDock.RowMeta>{SNAME[r.post.source] || r.post.source} · {r.post.outlier}×</CommandDock.RowMeta>
            </CommandDock.Row>
          ) : r.kind === 'hint' ? (
            <CommandDock.Row key={r.id} onSelect={() => ask(r.text)}>
              <MessageCircleQuestion aria-hidden="true" />
              <CommandDock.RowTitle className="font-normal text-muted-foreground">{r.text}</CommandDock.RowTitle>
            </CommandDock.Row>
          ) : (
            <CommandDock.Row key={r.id} className="items-start">
              {r.kind === 'error' && <CircleAlert aria-hidden="true" />}
              <span className="min-w-0 flex-1 whitespace-normal text-[13px] leading-relaxed">{r.text}</span>
            </CommandDock.Row>
          ))}
          {busy && <CommandDock.Status>Reading your data…</CommandDock.Status>}
        </CommandDock.Results>
      </CommandDock.Panel>
    </CommandDock>
  );
}
