'use client';
// Command menu — Ctrl+K / ⌘K anywhere (PanelUI Command, spotlight layout).
// Type to find a page, start something new, open a Toolkit tool, run or open
// an automation, jump to a mind map or a recent AI run. Enter runs the first
// match. Automations, maps and runs are loaded each time it opens.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from '@/components/panelui/command';
import { NAV, notifyActivity } from '@/components/panel';
import { toast } from '@/components/toaster';
import { TOOLS } from '@/lib/tools';
import { SNAME } from '@/components/kit';
import { BRAND } from '@/lib/brand';
import { CalendarClock, CirclePlay, Moon, Network, PenLine, Play, Plus, Search, Sparkles, Wrench, History } from 'lucide-react';

type Auto = { id: string; name: string; enabled: boolean; running?: boolean };
type MapInfo = { id: string; title: string; nodes: number };
type Run = { id: string; title: string; kind: string; status: string };

const ICON = 'size-4';

export function CommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [autos, setAutos] = useState<Auto[]>([]);
  const [maps, setMaps] = useState<MapInfo[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);

  useEffect(() => {
    if (!open) return;
    fetch('/api/automations').then(r => r.json()).then(j => setAutos(j.automations || [])).catch(() => {});
    fetch('/api/mindmaps').then(r => r.json()).then(j => setMaps(j.maps || [])).catch(() => {});
    fetch('/api/activity').then(r => r.json()).then(j => setRuns((j.runs || []).slice(0, 6))).catch(() => {});
  }, [open]);

  const go = (href: string) => router.push(href);
  const newMap = async (template: string) => {
    const j = await fetch('/api/mindmaps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create', template }) }).then(r => r.json()).catch(() => null);
    if (j?.map) { try { localStorage.setItem('payload.mindmap', j.map.id); } catch {} go('/mindmaps?id=' + j.map.id); }
  };
  const runAuto = async (a: Auto) => {
    const j = await fetch('/api/automations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'run', id: a.id }) }).then(r => r.json()).catch(e => ({ error: e.message }));
    if (j.error) { toast(`Could not start ${a.name}`, { description: j.error, type: 'destructive' }); return; }
    notifyActivity();
    toast(`${a.name} started`, { description: 'Follow it on Activity', type: 'info', action: { label: 'Open', onClick: () => go('/activity?filter=active') } });
  };
  const toggleTheme = () => {
    const dark = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('sc-theme', dark ? 'dark' : 'light'); } catch {}
  };
  const mod = mac ? '⌘' : 'Ctrl';

  return (
    <Command.Dialog hotkey="mod+k" open={open} onOpenChange={setOpen} label={`Search ${BRAND.name}`}
      trigger={
        <button type="button" className="hidden h-9 items-center gap-2 rounded-lg border border-border bg-card pl-3 pr-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground lg:inline-flex" aria-label="Search pages and actions">
          <Search className="size-4" aria-hidden="true" />
          <span className="w-28 text-left">Search…</span>
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium">{mod} K</kbd>
        </button>
      }>
      <Command>
        <Command.Input placeholder="Search pages, tools and actions…" />
        <Command.List>
          <Command.Empty>Nothing matches. Try a page name, a tool, or “new”.</Command.Empty>

          <Command.Group heading="Create">
            {['x', 'linkedin', 'threads', 'instagram'].map(p => (
              <Command.Item key={'gen-' + p} value={'gen-' + p} textValue={`New ${SNAME[p]} post`} icon={<PenLine className={ICON} />} kind="Generate" keywords={['write', 'draft', 'post', 'new', p]} onSelect={() => go(`/generate?platform=${p}`)}>
                New {SNAME[p]} post
              </Command.Item>
            ))}
            <Command.Item value="new-auto" textValue="New automation" icon={<CalendarClock className={ICON} />} kind="Automations" keywords={['schedule', 'workflow', 'cron', 'new']} onSelect={() => go('/automations')}>New automation</Command.Item>
            <Command.Item value="new-map" textValue="New mind map" icon={<Network className={ICON} />} kind="Mind maps" keywords={['brainstorm', 'new', 'map']} onSelect={() => newMap('blank')}>New mind map</Command.Item>
            <Command.Item value="new-map-pillars" textValue="New mind map from content pillars" icon={<Network className={ICON} />} kind="Mind maps" keywords={['template', 'pillars']} onSelect={() => newMap('pillars')}>New mind map: content pillars</Command.Item>
          </Command.Group>

          <Command.Group heading="Pages">
            {NAV.map(n => {
              const Icon = n.icon;
              return <Command.Item key={n.href} value={'page-' + n.href} textValue={n.label} icon={<Icon className={ICON} />} kind={n.group} keywords={['go', 'open', 'page']} onSelect={() => go(n.href)}>{n.label}</Command.Item>;
            })}
          </Command.Group>

          {autos.length > 0 && (
            <Command.Group heading="Automations">
              {autos.map(a => (
                <Command.Item key={'run-' + a.id} value={'run-' + a.id} textValue={`Run ${a.name}`} icon={<Play className={ICON} />} kind="Run now" subtitle={a.enabled ? undefined : 'paused'} keywords={['automation', 'run', 'start']} disabled={a.running} onSelect={() => runAuto(a)}>
                  Run {a.name}
                </Command.Item>
              ))}
              {autos.map(a => (
                <Command.Item key={'edit-' + a.id} value={'edit-' + a.id} textValue={`Edit ${a.name}`} icon={<CalendarClock className={ICON} />} kind="Automation" keywords={['automation', 'edit', 'schedule']} onSelect={() => go('/automations?id=' + a.id)}>
                  Edit {a.name}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {maps.length > 0 && (
            <Command.Group heading="Mind maps">
              {maps.map(m => (
                <Command.Item key={m.id} value={'map-' + m.id} textValue={m.title} icon={<Network className={ICON} />} kind="Mind map" subtitle={`${m.nodes} ideas`} keywords={['map', 'mind']} onSelect={() => { try { localStorage.setItem('payload.mindmap', m.id); } catch {} go('/mindmaps?id=' + m.id); }}>
                  {m.title}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          <Command.Group heading="Toolkit">
            {TOOLS.map(t => (
              <Command.Item key={t.key} value={'tool-' + t.key} textValue={t.name} icon={t.visual ? <Sparkles className={ICON} /> : <Wrench className={ICON} />} kind="Tool"
                subtitle={t.platforms.map(p => SNAME[p] || p).join(' · ')} keywords={['tool', t.group.toLowerCase(), ...t.platforms]} onSelect={() => go(`/toolkit?p=${t.platforms.includes('x') ? 'x' : t.platforms[0]}&t=${t.key}`)}>
                {t.name}
              </Command.Item>
            ))}
          </Command.Group>

          {runs.length > 0 && (
            <Command.Group heading="Recent AI runs">
              {runs.map(r => (
                <Command.Item key={r.id} value={'act-' + r.id} textValue={r.title} icon={<History className={ICON} />} kind={r.status} keywords={['run', 'activity', 'recent', r.kind]} onSelect={() => go('/activity?id=' + r.id)}>
                  {r.title}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          <Command.Group heading="Settings">
            <Command.Item value="theme" textValue="Toggle dark mode" icon={<Moon className={ICON} />} kind="Action" keywords={['theme', 'dark', 'light']} onSelect={toggleTheme}>Toggle dark / light mode</Command.Item>
            <Command.Item value="collect" textValue="Run a collector" icon={<CirclePlay className={ICON} />} kind="Sources" keywords={['apify', 'collect', 'scrape', 'refresh']} onSelect={() => go('/sources')}>Run a collector</Command.Item>
            <Command.Item value="newauto2" textValue="Schedule something" icon={<Plus className={ICON} />} kind="Automations" keywords={['later', 'future', 'date', 'time']} onSelect={() => go('/automations')}>Schedule something for later</Command.Item>
          </Command.Group>
        </Command.List>
        <Command.Footer lead={<span className="text-[12px] text-muted-foreground">{BRAND.name}</span>}>
          <Command.FooterAction keys={['↵']}>Open</Command.FooterAction>
          <Command.FooterDivider />
          <Command.FooterAction keys={['esc']} onClick={() => setOpen(false)}>Close</Command.FooterAction>
        </Command.Footer>
      </Command>
    </Command.Dialog>
  );
}
