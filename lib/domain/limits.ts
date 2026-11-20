// lib/limits.ts — exact post length the way each platform counts it (client-safe).
//
// AI models can't count characters, so the app counts. X uses weighted
// counting (twitter-text v3): most Latin/punctuation = 1, emoji and CJK = 2,
// every URL = 23 regardless of its length. A free X account allows 280.

const URL_RX = /\bhttps?:\/\/[^\s]+|\b(?:[a-z0-9-]+\.)+(?:com|io|dev|ai|app|org|net|co|gg|sh|xyz|me|tech)(?:\/[^\s]*)?/gi;

/** X weighted length (twitter-text v3 rules, close enough for limit checks). */
export function xLength(text: string): number {
  let n = 0;
  const withoutUrls = text.replace(URL_RX, () => { n += 23; return ''; });
  const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
  const graphemes = seg ? [...seg.segment(withoutUrls)].map(s => s.segment) : [...withoutUrls];
  for (const g of graphemes) {
    if (/\p{Extended_Pictographic}/u.test(g)) { n += 2; continue; } // an emoji (even a multi-codepoint one) counts 2
    for (const ch of g) {
      const cp = ch.codePointAt(0)!;
      const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
      n += light ? 1 : 2;
    }
  }
  return n;
}

export function platformLength(platform: string, text: string): number {
  return platform === 'x' ? xLength(text) : [...text].length;
}

/** Hard per-post limit for a platform/format (null = no meaningful limit, e.g. scripts). */
export function postLimit(platform: string, format?: string | null): number | null {
  if (format && /reel|short|tt-video|yt-long|tt-photo|carousel|document/.test(format)) return null; // scripts / slide decks
  switch (platform) {
    case 'x': return 280;           // free account; Premium allows long posts
    case 'linkedin': return 3000;
    case 'instagram': return 2200;
    case 'threads': return 500;
    case 'tiktok': return 4000;
    case 'youtube': return 5000;
    default: return null;
  }
}

/** A "first reply" link line the AI adds for X/LinkedIn ("(First reply: https://…)") — split it out of the post. */
export function splitFirstReply(text: string): { post: string; firstReply: string } {
  const lines = text.split('\n');
  // a "FIRST REPLY:" / "First comment:" label starts the reply block; everything after it
  // (same line and following lines) is the reply — it is posted separately, under the post
  const LABEL = /^\s*[(\[]?\s*(?:first reply|1st reply|first comment|reply 1|self[- ]reply)\s*[)\]]?\s*[:\-—]\s*/i;
  const idx = lines.findIndex(l => LABEL.test(l));
  if (idx >= 0) {
    const reply = [lines[idx].replace(LABEL, ''), ...lines.slice(idx + 1)].join('\n').replace(/^\s*\(|\)\s*$/g, '').trim();
    const post = lines.slice(0, idx).join('\n').replace(/^\s*---\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    if (reply) return { post, firstReply: reply };
  }
  return { post: text.trim(), firstReply: '' };
}

/** For thread text: split into posts (blank line before "2/", "3/"… or plain blank-line separated). */
export function threadPosts(text: string): string[] {
  const parts = text.split(/\n\s*\n(?=\s*\d+\s*\/)/);
  return (parts.length > 1 ? parts : text.split(/\n\s*\n/)).map(s => s.trim()).filter(Boolean);
}
