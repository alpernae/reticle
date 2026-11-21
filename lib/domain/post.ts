// lib/domain/post.ts — the shapes the domain works with.
//
// A Post is one collected or logged piece of content in the shape every
// platform is normalised into. The type lives here (not in engine.ts) so the
// pure domain modules never have to import anything that touches SQLite.
export type Post = {
  id: string; source: string; title: string; text: string; url: string; link: string; score: number; comments: number; created: number;
  T?: string; topics?: string[]; security?: boolean; dev?: boolean; views?: number;
  // v2 normalizer fields (see lib/normalize.ts) — absent on legacy rows
  author?: string; authorFollowers?: number; authorLocation?: string; shares?: number; saves?: number;
  media?: string; hashtags?: string[]; body?: string; durationSec?: number;
  aiCats?: string[]; // AI-assigned audience categories (lib/categories.ts keys)
};

export type Manual = { id: number; platform: string; text: string; eng: number; when: string; ts: number; likes?: number | null; comments?: number | null; views?: number | null };
