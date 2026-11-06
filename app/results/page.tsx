'use client';
// Results — the finished-output archive for Studio agents. Every run that ends
// (done, failed, stopped, interrupted) lands here with its full AI output;
// active runs live on the Workflows page. All state comes from /api/jobs.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, PageHead, Chip, btn, AGO } from '@/components/panel';
import { Copy, Check, Trash2, ArrowUpRight, FolderOpen } from 'lucide-react';

type Job = {
  id: string; kind: string; topic: string; platform: string;
  status: 'done' | 'failed' | 'stopped' | 'interrupted';
  result: string; err: string; created: number; started: number | null; finished: number | null;
};

const AGENT_NAME: Record<string, string> = {
  dive: 'Topic deep-dive', hooks: 'Hook hunter', calendar: 'Weekly calendar', autopsy: 'Winners autopsy',
};
const STATUS_CHIP: Record<Job['status'], { tone: 'z' | 'g' | 'r' | 'a'; label: string; title?: string }> = {
  done: { tone: 'z', label: 'done' },
  failed: { tone: 'r', label: 'failed' },
  stopped: { tone: 'a', label: 'stopped' },
  interrupted: { tone: 'a', label: 'interrupted', title: 'the dev server restarted mid-run' },
};

export default function Results() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const j = await (await fetch('/api/jobs')).json();
      // finished only — active runs are watched live on /workflows
      setJobs((j.jobs || []).filter((x: Job) => ['done', 'failed', 'stopped', 'interrupted'].includes(x.status)));
    } catch { /* transient — next tick retries */ }
  }, []);
  useEffect(() => { poll(); const t = setInterval(poll, 3000); return () => clearInterval(t); }, [poll]);

  const del = async (id: string) => { await fetch(`/api/jobs/${id}`, { method: 'DELETE' }).catch(() => {}); poll(); };
  const copy = (t: string, id: string) => { navigator.clipboard.writeText(t); setCopied(id); setTimeout(() => setCopied(null), 1800); };
  const sendToGenerate = (job: Job) => {
    try { sessionStorage.setItem('sc-studio-brief', JSON.stringify({ from: AGENT_NAME[job.kind] || job.kind, topic: job.topic, text: job.result })); } catch {}
    router.push('/generate');
  };

  const done = (jobs || []).filter(j => j.status === 'done');
  const fresh = [...(jobs || [])].sort((a, b) => (b.finished || 0) - (a.finished || 0));
  const headChip = jobs === null
    ? <Chip tone="a">…</Chip>
    : <Chip tone={done.length ? 'z' : 'a'}>{done.length ? `${done.length} result${done.length === 1 ? '' : 's'}` : 'no results yet'}</Chip>;

  return (
    <div>
      <PageHead
        title="Results"
        sub="The archive of finished agent outputs — research, hook sets, calendars and playbooks stay here. Copy them, or send one straight to Generate."
        right={headChip}
      />

      {jobs === null && <Card><div className="p-6 text-sm text-muted-foreground">Loading results…</div></Card>}

      {jobs?.length === 0 && (
        <Card><div className="py-14 text-center text-muted-foreground">
          <FolderOpen className="size-7 mx-auto mb-3 text-foreground/40" aria-hidden="true" />
          <b className="text-foreground font-semibold">No agent results yet</b>
          <p className="text-sm mt-1">Launch a workflow on the Workflows page — the moment it finishes, its full output is archived here.</p>
        </div></Card>
      )}

      <div className="space-y-4">
        {fresh.map(job => {
          const chip = STATUS_CHIP[job.status] || STATUS_CHIP.stopped;
          const when = job.finished ? AGO(job.finished) + ' ago' : AGO(job.created) + ' ago';
          return (
            <Card key={job.id} className={job.status !== 'done' ? 'opacity-90' : undefined}>
              <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-3 border-b border-border">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <b className="text-[13px] font-semibold">{AGENT_NAME[job.kind] || job.kind}</b>
                    <Chip tone={chip.tone} title={chip.title}>{chip.label}</Chip>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {job.topic || 'auto topic'} · {job.platform} · {when}
                  </div>
                </div>
                <div className="flex gap-2">
                  {job.status === 'done' && job.result && (
                    <>
                      <button onClick={() => sendToGenerate(job)} className={btn + ' h-8 px-3 text-xs'} aria-label="send result to generate">
                        <ArrowUpRight className="size-3.5" aria-hidden="true" /> Send to Generate
                      </button>
                      <button onClick={() => copy(job.result, job.id)} className={btn + ' h-8 px-3 text-xs'}>
                        {copied === job.id ? <><Check className="size-3.5" aria-hidden="true" /> Copied</> : <><Copy className="size-3.5" aria-hidden="true" /> Copy</>}
                      </button>
                    </>
                  )}
                  <button onClick={() => del(job.id)} className={btn + ' h-8 px-2.5'} title="Delete result" aria-label="delete result"><Trash2 className="size-3.5" aria-hidden="true" /></button>
                </div>
              </div>
              <div className="px-5 py-4">
                {job.status === 'done' && job.result
                  ? <pre className="font-sans whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{job.result}</pre>
                  : (
                    <div className="px-3 py-2.5 rounded-lg border border-border text-xs">
                      {job.err
                        ? <><b className="text-foreground font-semibold">{job.status === 'interrupted' ? 'Interrupted' : 'Failed'}:</b> <span className="text-muted-foreground">{job.err}</span></>
                        : <span className="text-muted-foreground">The run ended without producing a result{job.status === 'stopped' ? ' — it was stopped mid-run.' : '.'}</span>}
                    </div>
                  )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
