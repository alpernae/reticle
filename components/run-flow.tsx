'use client';
// RunFlow — one AI run drawn as a pipeline on a PanelUI Flow canvas:
//   What you asked → step 1 → step 2 → … → Result
// Done steps are solid, the live step pulses with a marching edge, a failed
// step is marked, and each step shows how long it took.
import { Flow } from '@/components/panelui/flow';

export type FlowStep = { label: string; at: number; state: string };

const dur = (ms: number) => (ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);
const BADGE: Record<string, { text: string; color: 'muted' | 'primary' | 'success' | 'destructive' }> = {
  done: { text: 'done', color: 'success' }, active: { text: 'now', color: 'primary' }, failed: { text: 'failed', color: 'destructive' },
  pending: { text: 'waiting', color: 'muted' }, skipped: { text: 'skipped', color: 'muted' },
};

export function RunFlow({ steps, status, created, finished, now, inputLabel, resultLabel, height = 'h-56' }: {
  steps: FlowStep[]; status: string; created: number; finished: number | null; now: number;
  inputLabel: string; resultLabel?: string; height?: string;
}) {
  const active = ['running', 'queued', 'paused'].includes(status);
  const X = 230; // column spacing
  const nodes = [
    { id: 'in', x: 0, title: 'What you asked', desc: inputLabel, state: 'done' as string, ms: null as number | null },
    ...steps.map((s, i) => {
      const end = steps[i + 1]?.at ?? (s.state === 'active' ? now : finished ?? s.at);
      return { id: 's' + i, x: X * (i + 1), title: s.label, desc: '', state: s.state, ms: Math.max(0, end - s.at) };
    }),
    {
      id: 'out', x: X * (steps.length + 1), title: 'Result',
      desc: resultLabel || (active ? 'on its way' : status === 'done' ? 'saved below' : status),
      state: active ? 'pending' : status === 'done' ? 'done' : 'failed', ms: null,
    },
  ];
  return (
    <Flow key={`${steps.length}-${status}`} className={`${height} rounded-xl`} fitViewOnMount fitViewPadding={24} maxZoom={1.1} label="Run pipeline">
      <Flow.Background variant="dots" />
      {nodes.map((n, i) => {
        const b = BADGE[n.state] || BADGE.pending;
        return (
          <Flow.Node key={n.id} id={n.id} position={{ x: n.x, y: i % 2 ? 26 : 0 }} draggable className={`w-48 ${n.state === 'active' ? 'ring-2 ring-foreground/60' : ''}`}>
            <Flow.NodeHeader>
              <span className="text-[11px] text-muted-foreground">{n.id === 'in' ? 'Input' : n.id === 'out' ? 'Output' : `Step ${i}`}</span>
              <Flow.NodeBadge color={b.color} className={n.state === 'active' ? 'animate-pulse' : ''}>{b.text}</Flow.NodeBadge>
            </Flow.NodeHeader>
            <Flow.NodeContent>
              <Flow.NodeTitle className="line-clamp-2 text-[13px]">{n.title}</Flow.NodeTitle>
              {(n.desc || n.ms != null) && (
                <Flow.NodeDescription className="line-clamp-2">{n.ms != null ? dur(n.ms) : n.desc}</Flow.NodeDescription>
              )}
            </Flow.NodeContent>
          </Flow.Node>
        );
      })}
      {nodes.slice(1).map((n, i) => {
        const from = nodes[i];
        const live = n.state === 'active' || (n.id === 'out' && active && from.state === 'active');
        return <Flow.Edge key={n.id} from={from.id} to={n.id} variant="smoothstep" arrow animated={live} dashed={n.state === 'pending' || n.state === 'skipped'} color={n.state === 'failed' ? 'destructive' : from.state === 'done' ? 'primary' : undefined} />;
      })}
      <Flow.Controls position="bottom-right" lock={false} />
    </Flow>
  );
}
