'use client';
// Sel — a drop-in for a native <select> that renders PanelUI's Select.
// Takes the same <option>/<optgroup> children and calls onChange with
// { target: { value } }, so existing handlers keep working unchanged.
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Select } from '@/components/panelui/select';

type Opt = { value: string; label: string; disabled?: boolean; title?: string };
type Group = { label: string | null; options: Opt[] };

const EMPTY = '__empty__'; // Base UI treats '' as "nothing chosen"
const enc = (v: string) => (v === '' ? EMPTY : v);
const dec = (v: string) => (v === EMPTY ? '' : v);

const text = (n: ReactNode): string => {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(text).join('');
  if (isValidElement(n)) return text((n.props as { children?: ReactNode }).children);
  return '';
};

function collect(children: ReactNode, groups: Group[], into: Group) {
  Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean; label?: string; title?: string }>;
    if (el.type === 'option') {
      const label = text(el.props.children);
      into.options.push({ value: String(el.props.value ?? label), label, disabled: el.props.disabled, title: el.props.title });
    } else if (el.type === 'optgroup') {
      const g: Group = { label: el.props.label ?? null, options: [] };
      groups.push(g);
      collect(el.props.children, groups, g);
    } else {
      collect(el.props.children, groups, into); // fragments and wrappers
    }
  });
}

export function Sel({ value, onChange, children, className, disabled, id, title, size = 'md', 'aria-label': ariaLabel }: {
  value: string | number;
  onChange: (e: { target: { value: string } }) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  title?: string;
  size?: 'sm' | 'md' | 'lg';
  'aria-label'?: string;
}) {
  const root: Group = { label: null, options: [] };
  const groups: Group[] = [root];
  collect(children, groups, root);
  const all = groups.flatMap(g => g.options);
  const items = all.map(o => ({ value: enc(o.value), label: o.label }));
  // keep only layout classes from the old native-select class string; the trigger draws its own box
  const layout = (className || '').split(/\s+/).filter(c => /^(w-|min-w-|max-w-|flex-|basis-|grow|shrink|self-|col-|h-)/.test(c)).join(' ');

  return (
    <Select items={items} value={enc(String(value))} onValueChange={(v: string | null) => v != null && onChange({ target: { value: dec(v) } })} disabled={disabled}>
      <Select.Trigger id={id} aria-label={ariaLabel} title={title} size={size} className={(layout.includes('w-') ? layout : 'w-full ' + layout).trim()}>
        <Select.Value />
      </Select.Trigger>
      <Select.Content alignItemWithTrigger={all.length <= 12} className="max-h-80">
        {groups.filter(g => g.options.length).map((g, i) => g.label
          ? (
            <Select.Group key={i}>
              <Select.GroupLabel>{g.label}</Select.GroupLabel>
              {g.options.map(o => <Select.Item key={o.value} value={enc(o.value)} disabled={o.disabled} title={o.title}>{o.label}</Select.Item>)}
            </Select.Group>
          )
          : g.options.map(o => <Select.Item key={o.value} value={enc(o.value)} disabled={o.disabled} title={o.title}>{o.label}</Select.Item>))}
      </Select.Content>
    </Select>
  );
}
