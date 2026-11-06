'use client';
// A generated quick post split into: text · code block(s) rendered as a PNG
// "code shot" (download / copy image / copy code) · a private answer.
import { useEffect, useMemo, useRef, useState } from 'react';
import { btn } from '@/components/panel';
import { renderCodeImage, splitPost } from '@/lib/code-image';
import { Check, Copy, Download, Eye, EyeOff, ImageIcon } from 'lucide-react';
import { FitBadge, type Fit } from '@/components/fit-badge';
import { PolishBox } from '@/components/polish-box';
import { LengthBadge } from '@/components/length-info';

function CodeShot({ code, lang, name }: { code: string; lang: string; name: string }) {
  const [url, setUrl] = useState('');
  const [done, setDone] = useState('');
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = renderCodeImage({ code, lang });
    canvas.current = cv;
    setUrl(cv.toDataURL('image/png'));
  }, [code, lang]);
  const flash = (k: string) => { setDone(k); setTimeout(() => setDone(''), 1600); };
  const copyImage = async () => {
    const cv = canvas.current; if (!cv) return;
    try {
      const blob: Blob = await new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('no blob'))), 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      flash('img');
    } catch { flash('img-fail'); }
  };
  return (
    <div className="space-y-2">
      <pre className="rounded-lg bg-muted px-3 py-2.5 overflow-x-auto text-[12px] leading-relaxed font-mono"><code>{code}</code></pre>
      {url && <img src={url} alt={`code image (${lang || 'code'})`} className="w-full rounded-lg border border-border" />}
      <div className="flex flex-wrap gap-2">
        <a className={btn + ' h-8 px-3 text-xs'} href={url} download={`${name}.png`}><Download className="size-3.5" aria-hidden="true" /> PNG</a>
        <button className={btn + ' h-8 px-3 text-xs'} onClick={copyImage}>{done === 'img' ? <><Check className="size-3.5" aria-hidden="true" /> Image copied</> : done === 'img-fail' ? 'Copy blocked — use PNG' : <><ImageIcon className="size-3.5" aria-hidden="true" /> Copy image</>}</button>
        <button className={btn + ' h-8 px-3 text-xs'} onClick={() => { navigator.clipboard.writeText('```' + lang + '\n' + code + '\n```'); flash('code'); }}>{done === 'code' ? <><Check className="size-3.5" aria-hidden="true" /> Copied</> : <><Copy className="size-3.5" aria-hidden="true" /> Code block</>}</button>
      </div>
    </div>
  );
}

export function QuickPostCard({ raw: initialRaw, idx, onSave, saved, fit: initialFit, platform, brief }: { raw: string; idx: number; onSave: (text: string) => void; saved: boolean; fit?: Fit; platform?: string; brief?: string }) {
  // local copy so Polish can replace the post text (code blocks + answer are kept as they are)
  const [raw, setRaw] = useState(initialRaw);
  const [fit, setFit] = useState(initialFit);
  const p = useMemo(() => splitPost(raw), [raw]);
  const [copied, setCopied] = useState(false);
  const [showAns, setShowAns] = useState(false);
  const replaceText = (t: string) => setRaw([t, ...p.code.map(c => '```' + c.lang + '\n' + c.code + '\n```'), p.answer ? `ANSWER: ${p.answer}` : ''].filter(Boolean).join('\n\n'));
  return (
    <div className="rounded-lg border border-border p-3 flex flex-col gap-2.5">
      <p className="whitespace-pre-wrap text-[14px] leading-snug">{p.text}</p>
      {p.code.map((c, i) => <CodeShot key={i} code={c.code} lang={c.lang} name={`challenge-${idx + 1}${i ? '-' + (i + 1) : ''}`} />)}
      {p.answer && (
        <div className="text-[12px]">
          <button className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setShowAns(v => !v)}>
            {showAns ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />} {showAns ? 'hide answer' : 'answer (for your reply)'}
          </button>
          {showAns && <p className="mt-1 rounded-md border border-border px-2.5 py-1.5">{p.answer}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 mt-auto">
        <FitBadge fit={fit} />
        {platform && <LengthBadge platform={platform} text={p.text} />}
        <button className={btn + ' h-8 px-3 text-xs'} onClick={() => { navigator.clipboard.writeText(p.text); setCopied(true); setTimeout(() => setCopied(false), 1600); }}>
          {copied ? <><Check className="size-3.5" aria-hidden="true" /> Copied</> : <><Copy className="size-3.5" aria-hidden="true" /> {p.code.length ? 'Copy text' : 'Copy'}</>}
        </button>
        <button className={btn + ' h-8 px-3 text-xs'} disabled={saved} onClick={() => onSave(p.code.length ? `${p.text}\n\n${p.code.map(c => '```' + c.lang + '\n' + c.code + '\n```').join('\n')}` : p.text)}>{saved ? '✓ in Winners' : 'Save to Winners'}</button>
        {platform && <PolishBox text={p.text} platform={platform} brief={brief} onApply={(t, f) => { replaceText(t); if (f) setFit(f); }} />}
      </div>
    </div>
  );
}
