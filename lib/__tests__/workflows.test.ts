// lib/__tests__/workflows.test.ts — the Studio agent runner.
//
// The runner is tested with a fake agent (no AI): what matters here is that a
// resumed workflow continues where it stopped instead of paying for the same
// AI calls twice.
import { describe, expect, it } from 'vitest';
import { runAgentSteps, type AgentDef, type AgentCtx } from '../application/workflows';

const ctx = (): AgentCtx => ({
  topic: 'a topic', platform: 'x', platformLabel: 'X / Twitter',
  digest: '', digestive: {} as AgentCtx['digestive'], picks: '', winners: '',
  notes: [], model: null,
});

function fakeAgent(onRun: (name: string) => void): AgentDef {
  return {
    kind: 'fake', name: 'Fake agent', tagline: 'test',
    steps: [
      { name: 'a', label: 'Step A', run: async () => { onRun('a'); return 'output of A'; } },
      { name: 'b', label: 'Step B', run: async (c) => { onRun('b'); return `output of B (after ${c.notes[0]})`; } },
    ],
  };
}

describe('agent runner', () => {
  it('runs every step and assembles the result', async () => {
    const ran: string[] = [];
    const c = ctx();
    const out = await runAgentSteps(fakeAgent(n => ran.push(n)), c, new AbortController().signal, [], () => {}, () => {});

    expect(ran).toEqual(['a', 'b']);
    expect(out.steps.map(s => s.text)).toEqual(['output of A', 'output of B (after output of A)']);
    expect(out.result).toContain('TOPIC: a topic');
    expect(out.result).toContain('output of A');
  });

  it('skips the steps that already finished when it resumes', async () => {
    const ran: string[] = [];
    const c = ctx();
    const out = await runAgentSteps(fakeAgent(n => ran.push(n)), c, new AbortController().signal, ['output of A'], () => {}, () => {});

    expect(ran).toEqual(['b']); // step A was not paid for again
    expect(out.steps[0].text).toBe('output of A');
    expect(out.steps[1].text).toContain('after output of A'); // the resumed step still sees the earlier note
  });

  it('stops when the signal is aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(runAgentSteps(fakeAgent(() => {}), ctx(), ac.signal, [], () => {}, () => {}))
      .rejects.toThrow(/cancelled/);
  });
});
