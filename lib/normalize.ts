// lib/normalize.ts — one clean post shape for every platform.
//
// Raw Apify datasets differ wildly per actor (and per actor version). Before
// v2 the importer kept only "text + likes + comments", which is why the AI
// could not reason about WHY a post won. This module maps every supported
// actor output into a NormalizedPost that keeps what matters for pattern work:
// who posted it (and their audience size), every public engagement counter,
// the post FORMAT (thread / carousel / short video / text…), hashtags, the
// full body, and duration for videos.
//
// Every mapper is defensive: unknown keys are ignored, missing metrics stay
// null (never invented), and an item without an id or posted time is dropped.
import 'server-only';
import { getStore, type PostRow } from './db';
import { classify, type Post } from './engine';

export type Platform = 'x' | 'linkedin' | 'instagram' | 'threads' | 'tiktok' | 'youtube';
export const PLATFORMS: Platform[] = ['x', 'linkedin', 'instagram', 'threads', 'tiktok', 'youtube'];
export const PLAT_LABEL: Record<Platform, string> = {
  x: 'X / Twitter', linkedin: 'LinkedIn', instagram: 'Instagram', threads: 'Threads', tiktok: 'TikTok', youtube: 'YouTube',
};
export function isPlatform(k: string): k is Platform { return (PLATFORMS as string[]).includes(k); }

/** How far back each platform is worth keeping. Long-form video lives longer. */
export const WINDOW_DAYS: Record<Platform, number> = { x: 60, linkedin: 45, instagram: 45, threads: 45, tiktok: 60, youtube: 120 };
export const MAX_WINDOW_DAYS = Math.max(...Object.values(WINDOW_DAYS));

export type Media = 'text' | 'image' | 'carousel' | 'video' | 'short' | 'thread' | 'poll' | 'link' | 'article' | 'document';

export type NormalizedPost = {
  id: string;               // '<platform>:<native id>' (legacy rows keep the 'apify-<platform>:' prefix)
  platform: Platform;
  url: string;
  author: string | null;
  authorFollowers: number | null;
  authorLocation?: string | null; // profile location, free text
  created: number;          // ms epoch
  body: string;             // full text / caption / title + description
  likes: number;
  comments: number;
  shares: number | null;
  saves: number | null;
  views: number | null;
  media: Media;
  hashtags: string[];
  durationSec: number | null;
};

// ---------------- tolerant field readers ----------------
const get = (o: any, path: string) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);
const pick = (o: any, ...paths: string[]) => {
  for (const p of paths) {
    const v = get(o, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};
const str = (o: any, ...paths: string[]): string | undefined => {
  const v = pick(o, ...paths);
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
};
const num = (o: any, ...paths: string[]): number | null => {
  for (const p of paths) {
    const v = get(o, p);
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseCount(v) : NaN;
    if (isFinite(n) && n >= 0) return n;
  }
  return null;
};
/** "1,234" · "12.5K" · "3M" → number */
function parseCount(s: string): number {
  const m = /^([\d.,]+)\s*([kmb])?$/i.exec(s.trim().replace(/\s/g, ''));
  if (!m) return NaN;
  const base = Number(m[1].replace(/,/g, ''));
  const mul = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase() as 'k' | 'm' | 'b'] || 1;
  return Math.round(base * mul);
}

const TW_MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
/** Twitter dates look like "Wed Oct 30 12:38:00 +0000 2026" — JS Date does not parse that reliably. */
export function twitterDate(s: string): number {
  const m = /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-])(\d{2})(\d{2})\s+(\d{4})$/.exec(String(s || '').trim());
  if (!m) { const t = Date.parse(String(s || '')); return isNaN(t) ? 0 : t; }
  const mo = TW_MONTHS[m[1]];
  if (mo === undefined) return 0;
  const sign = m[6] === '-' ? -1 : 1;
  const offMs = sign * (Number(m[7]) * 36e5 + Number(m[8]) * 6e4);
  return Date.UTC(Number(m[9]), mo, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) - offMs;
}
function when(o: any, ...paths: string[]): number {
  for (const p of paths) {
    const v = get(o, p);
    if (typeof v === 'number' && isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
    if (typeof v === 'string' && v) {
      if (/^\d{9,13}$/.test(v)) { const n = Number(v); return n < 1e12 ? n * 1000 : n; }
      const t = /^\w{3}\s+\w{3}/.test(v) ? twitterDate(v) : Date.parse(v);
      if (t && isFinite(t)) return t;
    }
  }
  return 0;
}
/** "00:12:34" · "12:34" · "PT12M34S" · 754 → seconds */
function duration(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return Math.round(v);
  if (typeof v !== 'string' || !v) return null;
  const iso = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(v);
  if (iso) return (+(iso[1] || 0)) * 3600 + (+(iso[2] || 0)) * 60 + (+(iso[3] || 0));
  const parts = v.split(':').map(Number);
  if (parts.every(n => isFinite(n))) return parts.reduce((a, b) => a * 60 + b, 0);
  return null;
}
function tagsFrom(text: string, extra?: unknown): string[] {
  const out = new Set<string>();
  if (Array.isArray(extra)) for (const t of extra) {
    const s = typeof t === 'string' ? t : t?.name || t?.text || t?.tag;
    if (s) out.add('#' + String(s).replace(/^#/, '').toLowerCase());
  }
  for (const m of String(text || '').matchAll(/#([\p{L}\p{N}_]{2,40})/gu)) out.add('#' + m[1].toLowerCase());
  return [...out].slice(0, 20);
}
const looksThread = (t: string) => /🧵|\bthread\b|^\s*1\s*[\/.)]\s|\(1\/\d+\)/i.test(t.slice(0, 280));

// ---------------- per-platform mappers ----------------
// apidojo/tweet-scraper (and look-alikes)
function mapX(t: any): NormalizedPost | null {
  if (t.isRetweet || t.retweetedStatus || t.retweeted_tweet) return null; // retweets carry someone else's engagement
  if (t.isReply === true || str(t, 'inReplyToUsername', 'in_reply_to_screen_name')) return null; // replies aren't standalone posts
  const body = str(t, 'fullText', 'full_text', 'text', 'tweetText') || '';
  if (/^RT @\w/.test(body)) return null;
  const id = str(t, 'id_str', 'id', 'tweetId');
  if (!id) return null;
  const author = str(t, 'author.userName', 'author.screen_name', 'user.screen_name', 'username', 'userDetails.userName') || null;
  const mediaArr: any[] = pick(t, 'extendedEntities.media', 'extended_entities.media', 'media') || [];
  const mtypes = Array.isArray(mediaArr) ? mediaArr.map(m => String(m?.type || '')) : [];
  const hasLink = (get(t, 'entities.urls') || []).length > 0 || /https?:\/\//.test(body.replace(/https:\/\/t\.co\/\w+$/, ''));
  const media: Media = t.poll || get(t, 'card.name')?.includes?.('poll') ? 'poll'
    : mtypes.some(x => /video|gif/.test(x)) ? 'video'
    : mtypes.length > 1 ? 'carousel' : mtypes.length === 1 ? 'image'
    : looksThread(body) ? 'thread' : hasLink ? 'link' : 'text';
  return {
    id: 'apify-x:' + id, platform: 'x',
    url: str(t, 'url', 'twitterUrl') || `https://x.com/${author || 'i'}/status/${id}`,
    author, authorFollowers: num(t, 'author.followers', 'author.followers_count', 'user.followers_count', 'author.followersCount'),
    authorLocation: str(t, 'author.location', 'user.location', 'place.full_name') || null,
    created: when(t, 'createdAt', 'created_at', 'timestamp'),
    body,
    likes: num(t, 'likeCount', 'favorite_count', 'likes') ?? 0,
    comments: num(t, 'replyCount', 'reply_count', 'replies') ?? 0,
    shares: sumNull(num(t, 'retweetCount', 'retweet_count'), num(t, 'quoteCount', 'quote_count')),
    saves: num(t, 'bookmarkCount', 'bookmark_count'),
    views: num(t, 'viewCount', 'views', 'view_count', 'impressions'),
    media, hashtags: tagsFrom(body, get(t, 'entities.hashtags')), durationSec: null,
  };
}

// apify/instagram-scraper (resultsType: posts)
function mapInstagram(g: any): NormalizedPost | null {
  const code = str(g, 'shortCode', 'shortcode', 'code');
  const id = str(g, 'id', 'pk') || code;
  if (!id) return null;
  const body = str(g, 'caption', 'edge_media_to_caption.edges.0.node.text') || '';
  const type = String(pick(g, 'type', 'media_type', '__typename') || '').toLowerCase();
  const isReel = /clips|reel/i.test(String(pick(g, 'productType', 'product_type') || ''));
  const media: Media = isReel ? 'short' : /sidecar|carousel|8/.test(type) ? 'carousel' : /video|2/.test(type) ? 'video' : 'image';
  return {
    id: 'apify-instagram:' + id, platform: 'instagram',
    url: str(g, 'url', 'postUrl') || (code ? `https://www.instagram.com/p/${code}/` : ''),
    author: str(g, 'ownerUsername', 'owner.username', 'username') || null,
    authorFollowers: num(g, 'ownerFollowersCount', 'owner.followersCount', 'owner.edge_followed_by.count'),
    created: when(g, 'timestamp', 'takenAtTimestamp', 'taken_at_timestamp', 'taken_at'),
    body,
    likes: num(g, 'likesCount', 'like_count', 'likes') ?? 0,
    comments: num(g, 'commentsCount', 'comment_count', 'comments') ?? 0,
    shares: num(g, 'sharesCount', 'reshareCount'), saves: num(g, 'savesCount'),
    views: num(g, 'videoPlayCount', 'videoViewCount', 'play_count', 'view_count'),
    media, hashtags: tagsFrom(body, g.hashtags), durationSec: duration(pick(g, 'videoDuration', 'video_duration')),
  };
}

// futurizerush/meta-threads-scraper (mode: user | search). Profile rows,
// replies and reposts are dropped — only the author's own posts carry their
// own engagement.
function mapThreads(t: any): NormalizedPost | null {
  if (t.record_type && t.record_type !== 'post') return null;
  if (t.is_reply || t.source_tab === 'reposts' || t.source_tab === 'replies' || t.reposted_by_username) return null;
  const code = str(t, 'post_code', 'code', 'shortcode');
  const id = code || str(t, 'id', 'pk');
  if (!id) return null;
  const body = str(t, 'text_content', 'text', 'caption') || '';
  const author = str(t, 'username', 'user.username', 'author') || null;
  const mt = String(pick(t, 'media_type') || '').toLowerCase();
  const media: Media = t.poll_options?.length ? 'poll'
    : /carousel/.test(mt) ? 'carousel' : /video|gif/.test(mt) ? 'video' : /photo|image/.test(mt) ? 'image'
    : t.link_title || (Array.isArray(t.urls) && t.urls.length) ? 'link' : 'text';
  return {
    id: 'threads:' + id, platform: 'threads',
    url: str(t, 'post_url', 'url') || (author && code ? `https://www.threads.com/@${author}/post/${code}` : ''),
    author, authorFollowers: num(t, 'followers_count', 'user.follower_count'),
    authorLocation: null,
    created: num(t, 'created_at_timestamp') != null ? num(t, 'created_at_timestamp')! * 1000 : when(t, 'created_at', 'taken_at'),
    body,
    likes: num(t, 'like_count', 'likes') ?? 0,
    comments: num(t, 'reply_count', 'replies') ?? 0,
    shares: sumNull(sumNull(num(t, 'repost_count'), num(t, 'quote_count')), num(t, 'share_count')),
    saves: null,
    views: num(t, 'view_count', 'views'),
    media, hashtags: tagsFrom(body, t.hashtags), durationSec: null,
  };
}

// apimaestro/linkedin-profile-posts (and similar profile-post actors)
function mapLinkedIn(l: any): NormalizedPost | null {
  if (/repost/i.test(String(l.post_type || l.postType || ''))) return null; // reshares carry someone else's engagement
  const body = str(l, 'text', 'commentary', 'postText', 'content') || '';
  const urn = l.urn && typeof l.urn === 'object' ? l.urn : null;
  const id = str(l, 'activityId', 'postId', 'id') || (urn ? String(urn.activity_urn || urn.share_urn || urn.ugcPost_urn || '') : str(l, 'urn'))
    || (/activity:(\d{8,})/.exec(String(l.full_urn || ''))?.[1] ?? '');
  if (!id) return null;
  const numeric = id.replace(/\D/g, '');
  const m = l.media && typeof l.media === 'object' ? l.media : {};
  const mt = String(m.type || l.mediaType || '').toLowerCase();
  const media: Media = l.document || /document|pdf/.test(mt) ? 'document'
    : /video/.test(mt) ? 'video'
    : (Array.isArray(m.images) && m.images.length > 1) || /multi|carousel/.test(mt) ? 'carousel'
    : /image/.test(mt) || m.url ? 'image'
    : l.poll ? 'poll' : l.article ? 'article' : 'text';
  const first = str(l, 'author.first_name', 'author.firstName'), last = str(l, 'author.last_name', 'author.lastName');
  return {
    id: 'apify-linkedin:' + id, platform: 'linkedin',
    url: str(l, 'url', 'postUrl', 'postedUrl') || (numeric.length >= 15 ? `https://www.linkedin.com/feed/update/urn:li:activity:${numeric}` : ''),
    author: str(l, 'author.username', 'author.public_identifier', 'authorProfileId') || [first, last].filter(Boolean).join(' ') || str(l, 'author.name', 'authorName') || null,
    authorFollowers: num(l, 'author.follower_count', 'author.followers', 'author.followersCount', 'authorFollowers'),
    authorLocation: str(l, 'author.location', 'author.geoLocation', 'authorLocation') || null,
    created: num(l, 'posted_at.timestamp') ?? when(l, 'postedAt', 'posted_at.date', 'postedDate', 'time'),
    body,
    likes: num(l, 'stats.total_reactions', 'numLikes', 'totalReactionCount', 'likes') ?? 0,
    comments: num(l, 'stats.comments', 'numComments', 'commentsCount', 'comments') ?? 0,
    shares: num(l, 'stats.reposts', 'stats.shares', 'numShares', 'repostsCount'),
    saves: null,
    views: num(l, 'stats.impressions', 'impressions', 'views'),
    media, hashtags: tagsFrom(body), durationSec: null,
  };
}

// clockworks/tiktok-scraper (and clockworks/free-tiktok-scraper)
function mapTikTok(v: any): NormalizedPost | null {
  const id = str(v, 'id', 'aweme_id');
  if (!id) return null;
  const body = str(v, 'text', 'desc', 'description') || '';
  const author = str(v, 'authorMeta.name', 'author.uniqueId', 'author') || null;
  return {
    id: 'tiktok:' + id, platform: 'tiktok',
    url: str(v, 'webVideoUrl', 'url') || (author ? `https://www.tiktok.com/@${author}/video/${id}` : ''),
    author, authorFollowers: num(v, 'authorMeta.fans', 'authorMeta.followers', 'author.followerCount'),
    created: when(v, 'createTimeISO', 'createTime', 'create_time'),
    body,
    likes: num(v, 'diggCount', 'likes', 'stats.diggCount') ?? 0,
    comments: num(v, 'commentCount', 'comments', 'stats.commentCount') ?? 0,
    shares: num(v, 'shareCount', 'shares', 'stats.shareCount'),
    saves: num(v, 'collectCount', 'stats.collectCount'),
    views: num(v, 'playCount', 'views', 'stats.playCount'),
    media: v.isSlideshow || v.imagePost ? 'carousel' : 'short',
    hashtags: tagsFrom(body, v.hashtags), durationSec: duration(pick(v, 'videoMeta.duration', 'duration')),
  };
}

// streamers/youtube-scraper — and the free YouTube Data API collector (lib/youtube.ts) builds this shape directly
function mapYouTube(y: any): NormalizedPost | null {
  const id = str(y, 'id', 'videoId');
  if (!id) return null;
  const title = str(y, 'title') || '';
  const desc = str(y, 'text', 'description') || '';
  const dur = duration(pick(y, 'duration', 'lengthSeconds'));
  const url = str(y, 'url') || `https://www.youtube.com/watch?v=${id}`;
  const isShort = /\/shorts\//.test(url) || y.type === 'shorts' || (dur != null && dur <= 62);
  return {
    id: 'youtube:' + id, platform: 'youtube', url,
    author: str(y, 'channelName', 'channelTitle', 'channel.name') || null,
    authorFollowers: num(y, 'numberOfSubscribers', 'channelSubscribers', 'subscriberCount'),
    authorLocation: str(y, 'channelLocation', 'channelCountry', 'country') || null,
    created: when(y, 'date', 'uploadDate', 'publishedAt'),
    body: desc ? `${title}\n\n${desc}` : title,
    likes: num(y, 'likes', 'likeCount') ?? 0,
    comments: num(y, 'commentsCount', 'commentCount', 'comments') ?? 0,
    shares: null, saves: null,
    views: num(y, 'viewCount', 'views'),
    media: isShort ? 'short' : 'video',
    hashtags: tagsFrom(title + ' ' + desc, y.hashtags), durationSec: dur,
  };
}
function sumNull(a: number | null, b: number | null): number | null {
  return a == null && b == null ? null : (a || 0) + (b || 0);
}

const MAPPERS: Record<Platform, (it: any) => NormalizedPost | null> = {
  x: mapX, instagram: mapInstagram, threads: mapThreads, linkedin: mapLinkedIn, tiktok: mapTikTok, youtube: mapYouTube,
};
export function normalize(platform: Platform, it: any): NormalizedPost | null {
  if (!it || typeof it !== 'object') return null;
  try { return MAPPERS[platform](it); } catch { return null; }
}

/** Some actors wrap rows: apimaestro returns { data: { posts: [...] } } per dataset row. */
export function flatten(platform: Platform, items: any[]): any[] {
  if (platform !== 'linkedin') return items || [];
  return (items || []).flatMap(it => (Array.isArray(it?.data?.posts) ? it.data.posts : [it]));
}

export type ImportCounts = { added: number; updated: number; skipped: number };

/** Persist normalized posts (idempotent: known ids refresh their metrics). */
export function importNormalized(posts: (NormalizedPost | null)[]): ImportCounts {
  const store = getStore();
  let added = 0, updated = 0, skipped = 0;
  for (const n of posts) {
    if (!n || !n.created) { skipped++; continue; } // no posted time → outside every time-based insight
    if (Date.now() - n.created > WINDOW_DAYS[n.platform] * 864e5) { skipped++; continue; }
    if (!n.body && !n.likes && !n.views) { skipped++; continue; }
    const title = firstLine(n.body) || n.body;
    const p: Post = {
      id: n.id, source: n.platform, title: title.slice(0, 300), text: n.body.slice(0, 400),
      url: n.url, link: n.url, score: n.likes, comments: n.comments, created: n.created,
      views: n.views ?? undefined, security: false, dev: false,
    };
    const row: PostRow = {
      id: p.id, source: p.source, title: p.title, text: p.text, url: p.url, link: p.link,
      score: p.score, comments: p.comments, created: p.created, T: '', topics: '[]', security: 0, dev: 0,
      views: n.views, author: n.author, authorFollowers: n.authorFollowers, authorLocation: n.authorLocation ?? null, shares: n.shares, saves: n.saves,
      media: n.media, hashtags: JSON.stringify(n.hashtags), body: n.body.slice(0, 5000), durationSec: n.durationSec,
    };
    if (store.hasPost(p.id)) { store.upsertPost(row); updated++; continue; }
    p.text = n.body; // classify on the FULL body, store the snippet
    classify(p);
    row.T = (p.T || '').slice(0, 2000); row.topics = JSON.stringify(p.topics || []);
    row.security = p.security ? 1 : 0; row.dev = p.dev ? 1 : 0;
    store.upsertPost(row); added++;
  }
  if (added || updated) store.prunePosts(Date.now() - MAX_WINDOW_DAYS * 864e5);
  return { added, updated, skipped };
}

export function importItems(platform: Platform, items: any[]): ImportCounts {
  return importNormalized(flatten(platform, items).map(it => normalize(platform, it)));
}

/** The hook = what shows before "…more". First non-empty line, capped. */
export function firstLine(s: string): string {
  const line = String(s || '').split('\n').map(l => l.trim()).find(Boolean) || '';
  return line.length > 220 ? line.slice(0, 219) + '…' : line;
}
