// lib/youtube.ts — FREE YouTube collector via the official YouTube Data API v3.
//
// A Google Cloud API key (no OAuth, no billing) gets 10,000 quota units/day.
// One channel costs ~3 units (channels.list + playlistItems.list + videos.list),
// so even 50 channels a day is ~150 units — effectively free forever, and it
// returns exact public views / likes / comments / subscriber counts.
// Channel list is shared with the YouTube row on Sources.
import 'server-only';
import { getStore } from './db';
import { importNormalized, type NormalizedPost, type ImportCounts } from './normalize';
import { readConfig } from './apify';

const API = 'https://www.googleapis.com/youtube/v3';

export function getYouTubeKey(): string | null {
  const k = (getStore().getMeta('youtubeApiKey') || '').trim();
  return k.length >= 20 ? k : null;
}
export function setYouTubeKey(k: string) { getStore().setMeta('youtubeApiKey', String(k || '').trim().slice(0, 120)); }
export function youtubeStatus() {
  const k = getYouTubeKey();
  let last: unknown = null;
  try { last = JSON.parse(getStore().getMeta('youtubeLastRun') || 'null'); } catch {}
  return { connected: !!k, mask: k ? '••••' + k.slice(-4) : null, last };
}

async function yt<T = any>(path: string, params: Record<string, string>, key: string): Promise<T> {
  const qs = new URLSearchParams({ ...params, key });
  const r = await fetch(`${API}/${path}?${qs}`, { signal: AbortSignal.timeout(20000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || 'HTTP ' + r.status);
  return j as T;
}

export async function verifyYouTubeKey(key: string): Promise<{ ok: boolean; error?: string }> {
  try { await yt('videoCategories', { part: 'snippet', regionCode: 'US' }, key); return { ok: true }; }
  catch (e: any) { return { ok: false, error: String(e.message).slice(0, 160) }; }
}

function channelParam(s: string): Record<string, string> {
  const t = s.trim();
  const id = /(?:channel\/)?(UC[\w-]{22})/.exec(t)?.[1];
  if (id) return { id };
  const handle = /@([\w.-]{3,30})/.exec(t)?.[1] || t.replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').replace(/^@/, '').replace(/[/?].*$/, '');
  return { forHandle: '@' + handle };
}

/** Pull the newest uploads of every channel on the YouTube source list. */
export async function collectYouTube(perChannel = 10): Promise<ImportCounts & { channels: number; errors: string[] }> {
  const key = getYouTubeKey();
  if (!key) throw new Error('No YouTube API key — add one on Settings (free, from Google Cloud Console).');
  const list = readConfig().youtube.sources.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean);
  if (!list.length) throw new Error('Add at least one @channel to the YouTube row on Sources.');
  const errors: string[] = [];
  const posts: NormalizedPost[] = [];
  for (const src of list.slice(0, 50)) {
    try {
      const ch = await yt('channels', { part: 'snippet,statistics,contentDetails', ...channelParam(src) }, key);
      const c = ch.items?.[0];
      if (!c) { errors.push(`${src}: channel not found`); continue; }
      const uploads = c.contentDetails?.relatedPlaylists?.uploads;
      const subs = Number(c.statistics?.subscriberCount);
      const pl = await yt('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: String(Math.min(50, perChannel)) }, key);
      const ids = (pl.items || []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
      if (!ids.length) continue;
      const vids = await yt('videos', { part: 'snippet,statistics,contentDetails', id: ids.join(',') }, key);
      for (const v of vids.items || []) {
        const dur = isoDur(v.contentDetails?.duration);
        const title = v.snippet?.title || '';
        const desc = String(v.snippet?.description || '').slice(0, 1500);
        posts.push({
          id: 'youtube:' + v.id, platform: 'youtube', url: `https://www.youtube.com/watch?v=${v.id}`,
          author: c.snippet?.customUrl || c.snippet?.title || null,
          authorFollowers: isFinite(subs) ? subs : null,
          created: Date.parse(v.snippet?.publishedAt) || 0,
          body: desc ? `${title}\n\n${desc}` : title,
          likes: Number(v.statistics?.likeCount) || 0,
          comments: Number(v.statistics?.commentCount) || 0,
          shares: null, saves: null,
          views: v.statistics?.viewCount != null ? Number(v.statistics.viewCount) : null,
          media: dur != null && dur <= 62 ? 'short' : 'video',
          hashtags: (v.snippet?.tags || []).slice(0, 12).map((t: string) => '#' + t.toLowerCase().replace(/\s+/g, '')),
          durationSec: dur,
        });
      }
    } catch (e: any) { errors.push(`${src}: ${String(e.message).slice(0, 120)}`); }
  }
  const counts = importNormalized(posts);
  const res = { ...counts, channels: list.length, errors };
  getStore().setMeta('youtubeLastRun', JSON.stringify({ ts: Date.now(), ...res }));
  return res;
}

function isoDur(s: unknown): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(s || ''));
  if (!m) return null;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
}
