// lib/code-image.ts — renders a code snippet as a shareable PNG (browser canvas,
// no dependencies). Dark editor window, traffic lights, file name, line
// numbers, light syntax colouring. 2× pixel ratio so it stays crisp on X.
// Client-only: uses document/canvas.

export type CodeImageOpts = { code: string; lang?: string; title?: string; scale?: number };

const KEYWORDS = new Set((
  // JS/TS
  'const let var function return if else for while do switch case break continue new class extends implements interface type enum import from export default async await try catch finally throw typeof instanceof in of this super null undefined true false void yield static public private protected readonly as ' +
  // Python
  'def lambda pass None True False and or not is with elif except raise global nonlocal assert print self ' +
  // Swift / Kotlin / Dart / Go / Java / PHP
  'func guard struct let var fun val override open data object when init final late required package go defer chan map range interface select echo require include namespace use fn ' +
  // SQL / shell
  'SELECT FROM WHERE AND OR INSERT INTO VALUES UPDATE SET DELETE JOIN ON LIMIT ORDER BY GROUP UNION select from where insert update delete join limit union then fi done esac curl'
).split(/\s+/));

const C = {
  bg1: '#0f172a', bg2: '#1e1b4b', win: '#0b1020', bar: '#151b2e', text: '#e2e8f0', dim: '#64748b',
  kw: '#c084fc', str: '#86efac', num: '#fbbf24', com: '#6b7a90', fn: '#7dd3fc', punct: '#94a3b8',
};

type Tok = { t: string; c: string };
function tokenize(line: string, lang: string): Tok[] {
  const out: Tok[] = [];
  const hashComment = /^(py|python|sh|bash|shell|zsh|rb|ruby|yaml|yml|toml)$/i.test(lang);
  const re = /(\/\/.*$|#.*$|--\s.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)|(\s+)|(.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const [all, com, str, num, call, word, ws] = m;
    if (com) {
      const isHash = com.startsWith('#'), isDash = com.startsWith('--');
      if ((isHash && !hashComment) || (isDash && !/sql/i.test(lang))) { out.push({ t: com[0], c: C.punct }); re.lastIndex = m.index + 1; continue; }
      out.push({ t: com, c: C.com });
    } else if (str) out.push({ t: str, c: C.str });
    else if (num) out.push({ t: num, c: C.num });
    else if (call) out.push({ t: call, c: KEYWORDS.has(call) ? C.kw : C.fn });
    else if (word) out.push({ t: word, c: KEYWORDS.has(word) ? C.kw : C.text });
    else if (ws) out.push({ t: ws, c: C.text });
    else out.push({ t: all, c: C.punct });
  }
  return out;
}

const EXT: Record<string, string> = { js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts', tsx: 'tsx', jsx: 'jsx', py: 'py', python: 'py', swift: 'swift', kotlin: 'kt', kt: 'kt', dart: 'dart', go: 'go', java: 'java', php: 'php', sql: 'sql', bash: 'sh', sh: 'sh', shell: 'sh', http: 'http', json: 'json', html: 'html', rust: 'rs', rs: 'rs', ruby: 'rb', c: 'c', cpp: 'cpp' };

export function renderCodeImage({ code, lang = '', title, scale = 2 }: CodeImageOpts): HTMLCanvasElement {
  const lines = code.replace(/\t/g, '  ').replace(/\s+$/, '').split('\n').slice(0, 40);
  const font = '15px "JetBrains Mono", "Cascadia Code", Consolas, Menlo, monospace';
  const lh = 24, pad = 48, bar = 40, gutter = 44, inner = 22;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const textW = Math.max(...lines.map(l => measure.measureText(l).width), 320);
  const winW = Math.min(1100, Math.ceil(gutter + textW + inner * 2));
  const winH = bar + inner * 2 + lines.length * lh;
  const W = winW + pad * 2, H = winH + pad * 2;

  const cv = document.createElement('canvas');
  cv.width = W * scale; cv.height = H * scale;
  const g = cv.getContext('2d')!;
  g.scale(scale, scale);
  // background
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, C.bg1); grad.addColorStop(1, C.bg2);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // window + shadow
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 40; g.shadowOffsetY = 16;
  round(g, pad, pad, winW, winH, 12); g.fillStyle = C.win; g.fill();
  g.restore();
  // title bar
  g.save(); round(g, pad, pad, winW, winH, 12); g.clip();
  g.fillStyle = C.bar; g.fillRect(pad, pad, winW, bar);
  g.restore();
  ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => { g.beginPath(); g.arc(pad + 20 + i * 20, pad + bar / 2, 6, 0, Math.PI * 2); g.fillStyle = col; g.fill(); });
  g.font = '13px "Segoe UI", system-ui, sans-serif'; g.fillStyle = C.dim; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(title || `challenge.${EXT[lang.toLowerCase()] || lang || 'txt'}`, pad + winW / 2, pad + bar / 2);
  // code
  g.font = font; g.textBaseline = 'alphabetic';
  lines.forEach((line, i) => {
    const y = pad + bar + inner + (i + 1) * lh - 7;
    g.textAlign = 'right'; g.fillStyle = C.dim; g.fillText(String(i + 1), pad + gutter - 10, y);
    g.textAlign = 'left';
    let x = pad + gutter + 4;
    for (const tk of tokenize(line, lang)) { g.fillStyle = tk.c; g.fillText(tk.t, x, y); x += g.measureText(tk.t).width; }
  });
  return cv;
}

function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Split a generated post into plain text, fenced code blocks and an optional "ANSWER:" line. */
export function splitPost(raw: string): { text: string; code: { lang: string; code: string }[]; answer: string } {
  const code: { lang: string; code: string }[] = [];
  let text = raw.replace(/```([\w+#-]*)[^\n]*\n([\s\S]*?)```/g, (_m, lang: string, body: string) => { code.push({ lang: lang || '', code: body.replace(/\n$/, '') }); return '\n'; });
  let answer = '';
  text = text.replace(/\n?\s*ANSWER\s*:\s*([\s\S]*)$/i, (_m, a: string) => { answer = a.trim(); return ''; });
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), code, answer };
}
