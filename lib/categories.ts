// lib/categories.ts — audience categories used by the dashboard filters.
// Client-safe (no server imports). A post's categories = the ones its
// classifier topics map to (rules) ∪ the ones Claude assigned (aiCats,
// lib/categorize.ts) — so casual posts the keyword rules miss still land
// somewhere. 'none' = neither rules nor AI placed it.
export const CATEGORIES: { key: string; label: string; topics: string[]; hint: string }[] = [
  { key: 'security', label: 'Security & bug bounty', topics: ['Cybersecurity', 'Hacking & Exploits', 'Privacy & OSINT', 'Auth & Identity'], hint: 'vulns, bug bounty, hacking, appsec, privacy, security tooling' },
  { key: 'mobile', label: 'Mobile apps', topics: ['Mobile Dev'], hint: 'iOS/Android apps, Swift, Kotlin, Flutter, React Native, App Store, building/marketing a mobile app' },
  { key: 'saas', label: 'SaaS & startups', topics: ['SaaS & Startups', 'Tools & Launches'], hint: 'founders, MRR/revenue, launches, marketing, pricing, customers, indie hacking' },
  { key: 'ai-tools', label: 'AI tools & tips', topics: ['AI & LLMs'], hint: 'AI models/tools news, "you can now…", "have you tried…", prompts, Claude/GPT/Codex/OpenCode/Cursor tips' },
  { key: 'dev', label: 'Coding & dev', topics: ['Python', 'JS / Web / Frontend', 'DevOps & Cloud', 'Databases', 'Rust / Go / Systems'], hint: 'programming, frameworks, infra, debugging, dev workflow' },
  { key: 'career', label: 'Career & growth', topics: ['Career & Growth'], hint: 'jobs, productivity, learning, burnout, freelancing, motivation' },
  { key: 'life', label: 'Life & opinions', topics: [], hint: 'personal life, humor, general opinions, world events, casual chatter' },
  { key: 'none', label: 'Uncategorized', topics: [], hint: '' },
];
export const CATEGORY_KEYS = CATEGORIES.filter(c => c.key !== 'none').map(c => c.key);

/** Categories from rule-based topics + AI-assigned keys. */
export function catsOf(p: { topics?: string[]; aiCats?: string[] }): string[] {
  const out = new Set<string>(p.aiCats || []);
  for (const c of CATEGORIES) if (c.topics.some(t => p.topics?.includes(t))) out.add(c.key);
  return [...out];
}

export function inCategory(p: { topics?: string[]; aiCats?: string[] }, key: string): boolean {
  if (!key) return true;
  if (key.startsWith('topic:')) return !!p.topics?.includes(key.slice(6));
  const cats = catsOf(p);
  return key === 'none' ? cats.length === 0 : cats.includes(key);
}

export function categoryCounts(posts: { topics?: string[]; aiCats?: string[] }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of CATEGORIES) out[c.key] = posts.filter(p => inCategory(p, c.key)).length;
  return out;
}
