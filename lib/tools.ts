// lib/tools.ts — the platform toolkit registry (client-safe).
// Every tool declares which platforms it serves, its form fields and the
// platform's hard limits. Text tools run through /api/tools (grounded in your
// collected winners, pattern lifts and real hashtag performance); visual tools
// render in the browser (lib/visuals.ts) — optionally with AI-suggested copy.

export type ToolPlatform = 'instagram' | 'threads' | 'x' | 'linkedin' | 'youtube';
export const TOOL_PLATFORMS: { key: ToolPlatform; label: string; source: string }[] = [
  { key: 'instagram', label: 'Instagram', source: 'instagram' },
  { key: 'threads', label: 'Threads', source: 'threads' },
  { key: 'x', label: 'X', source: 'x' },
  { key: 'linkedin', label: 'LinkedIn', source: 'linkedin' },
  { key: 'youtube', label: 'YouTube', source: 'youtube' },
];

export type ToolField = {
  key: string; label: string; kind: 'text' | 'textarea' | 'select';
  options?: { value: string; label: string }[]; placeholder?: string; optional?: boolean;
};
export type ToolGroup = 'Profile' | 'Ideas' | 'Writing' | 'Discovery' | 'Engagement' | 'Visual';
export type VisualKind = 'yt-thumbnail' | 'ig-reel-cover' | 'carousel' | 'banner' | 'post-image';

export type ToolDef = {
  key: string; name: string; group: ToolGroup; platforms: ToolPlatform[];
  desc: string; fields: ToolField[];
  visual?: VisualKind;          // rendered client-side; AI only suggests the copy
  output: 'items' | 'single' | 'slides';
};

const TOPIC: ToolField = { key: 'topic', label: 'Topic / idea', kind: 'textarea', placeholder: 'e.g. how I found an IDOR in a mobile app’s old /v1 API' };
const AUDIENCE: ToolField = {
  key: 'audience', label: 'Audience', kind: 'select', options: [
    { value: 'mix', label: 'Mix of my audiences' }, { value: 'security', label: 'Security researchers / bug hunters' },
    { value: 'mobile', label: 'Mobile developers' }, { value: 'saas', label: 'SaaS & startup founders' },
    { value: 'bridge', label: 'Security × builders' },
  ],
};
const TONE: ToolField = {
  key: 'tone', label: 'Tone', kind: 'select', optional: true, options: [
    { value: 'casual', label: 'Casual' }, { value: 'professional', label: 'Professional' }, { value: 'witty', label: 'Witty' },
    { value: 'educational', label: 'Educational' }, { value: 'bold', label: 'Bold / contrarian' },
  ],
};

export const TOOLS: ToolDef[] = [
  // ---- Profile ----
  { key: 'bio', name: 'Bio generator', group: 'Profile', platforms: ['instagram', 'threads', 'x', 'linkedin', 'youtube'], output: 'items',
    desc: 'Profile bios that say who you are, who it’s for and why follow — within each platform’s limit (IG 150 · Threads 150 · X 160 · LinkedIn headline 220 + About · YouTube 1,000).',
    fields: [{ key: 'focus', label: 'What to emphasise', kind: 'text', placeholder: 'e.g. bug bounty + building my first app', optional: true }, { key: 'cta', label: 'Link / CTA', kind: 'text', placeholder: 'e.g. newsletter, app waitlist, GitHub', optional: true }, TONE] },
  { key: 'pinned', name: 'Pinned / “start here” post', group: 'Profile', platforms: ['x', 'threads', 'linkedin'], output: 'items',
    desc: 'The post new profile visitors read first: who you are, proof, what they get by following.',
    fields: [{ key: 'proof', label: 'Real proof points', kind: 'textarea', placeholder: 'e.g. 40 valid reports, 2 crits, building X app — only real facts', optional: true }, TONE] },

  // ---- Ideas ----
  { key: 'ideas', name: 'Content ideas', group: 'Ideas', platforms: ['instagram', 'threads', 'x', 'linkedin', 'youtube'], output: 'items',
    desc: '10 ideas shaped like the winners in your data for this platform — each with format, hook and why it should work.',
    fields: [{ ...TOPIC, label: 'Theme (optional)', optional: true, placeholder: 'leave empty to mix your pillars' }, AUDIENCE] },
  { key: 'hooks', name: 'Hook generator', group: 'Ideas', platforms: ['instagram', 'threads', 'x', 'linkedin', 'youtube'], output: 'items',
    desc: '10 first lines / first 3 seconds for one idea, mixing the hook types that lift results on this platform.',
    fields: [TOPIC, AUDIENCE] },

  // ---- Writing ----
  { key: 'caption', name: 'Caption / post writer', group: 'Writing', platforms: ['instagram', 'threads', 'x', 'linkedin', 'youtube'], output: 'items',
    desc: 'Instagram captions, Threads posts, X posts, LinkedIn posts, YouTube community posts — 3 variants in the platform’s native shape.',
    fields: [TOPIC, AUDIENCE, TONE, { key: 'cta', label: 'Call to action', kind: 'text', placeholder: 'e.g. save this, comment “IDOR”, follow for part 2', optional: true }] },
  { key: 'thread', name: 'Thread writer', group: 'Writing', platforms: ['x', 'threads'], output: 'single',
    desc: 'A 5–9 post X thread or Threads chain: hook post, numbered body, a strong last post with CTA.',
    fields: [TOPIC, AUDIENCE, { key: 'length', label: 'Posts', kind: 'select', options: [{ value: '5', label: '5' }, { value: '7', label: '7' }, { value: '9', label: '9' }] }] },
  { key: 'yt-titles', name: 'Title + thumbnail text', group: 'Writing', platforms: ['youtube'], output: 'items',
    desc: '10 YouTube titles (≤ 60 chars) each paired with 2–4 word thumbnail text that adds curiosity instead of repeating the title.',
    fields: [TOPIC, AUDIENCE] },
  { key: 'yt-description', name: 'Description, chapters & tags', group: 'Writing', platforms: ['youtube'], output: 'single',
    desc: 'SEO description (first 2 lines matter most), timestamps/chapters from your outline, links block, 15 tags.',
    fields: [{ key: 'title', label: 'Video title', kind: 'text' }, { key: 'outline', label: 'Outline / transcript notes', kind: 'textarea', placeholder: '0:00 intro … or loose notes' }, { key: 'links', label: 'Links to include', kind: 'textarea', optional: true }] },
  { key: 'script', name: 'Short-video script', group: 'Writing', platforms: ['instagram', 'youtube'], output: 'single',
    desc: 'Reel / Short script: 0–2s pattern interrupt, 3 beats, loop ending — with on-screen text and shot list.',
    fields: [TOPIC, AUDIENCE, { key: 'length', label: 'Length', kind: 'select', options: [{ value: '20', label: '~20s' }, { value: '35', label: '~35s' }, { value: '55', label: '~55s' }] }] },
  { key: 'repurpose', name: 'Repurpose a post', group: 'Writing', platforms: ['instagram', 'threads', 'x', 'linkedin', 'youtube'], output: 'items',
    desc: 'Turn a post from another platform into this platform’s native format (not a copy-paste).',
    fields: [{ key: 'source', label: 'Original post', kind: 'textarea', placeholder: 'paste a post you already published' }] },

  // ---- Discovery ----
  { key: 'hashtags', name: 'Hashtags & keywords', group: 'Discovery', platforms: ['instagram', 'x', 'linkedin', 'youtube'], output: 'single',
    desc: 'Tiered hashtag sets (broad / mid / niche) plus search keywords — using the real performance of hashtags in your collected data.',
    fields: [TOPIC] },

  // ---- Engagement ----
  { key: 'replies', name: 'Reply writer', group: 'Engagement', platforms: ['x', 'threads', 'linkedin', 'instagram'], output: 'items',
    desc: 'Replies to a bigger account’s post that get seen — it reads the post’s game first (“one word”, “3 emojis”, “drop yours”…) and plays it, with your niche twist. Every reply is checked against the rule.',
    fields: [
      { key: 'source', label: 'Their post', kind: 'textarea', placeholder: 'paste the post you want to reply to' },
      { key: 'goal', label: 'Goal', kind: 'select', options: [{ value: 'noticed', label: 'Get noticed by their audience' }, { value: 'author', label: 'Get the author to reply' }, { value: 'debate', label: 'Start a side conversation' }] },
      { key: 'existing', label: 'Replies already under it', kind: 'textarea', optional: true, placeholder: 'paste a few top replies (and the author’s answers) — yours won’t repeat them' },
    ] },

  // ---- Visual ----
  { key: 'yt-thumbnail', name: 'Thumbnail designer', group: 'Visual', platforms: ['youtube'], visual: 'yt-thumbnail', output: 'items',
    desc: '1280×720 thumbnail: big 2–4 word text, highlight word, optional screenshot/face photo. AI suggests text options.', fields: [TOPIC] },
  { key: 'reel-cover', name: 'Reel cover', group: 'Visual', platforms: ['instagram'], visual: 'ig-reel-cover', output: 'items',
    desc: '1080×1920 cover with the text kept inside the 1080×1440 grid-safe area so it isn’t cropped on your profile grid.', fields: [TOPIC] },
  { key: 'carousel', name: 'Carousel slides', group: 'Visual', platforms: ['instagram', 'linkedin'], visual: 'carousel', output: 'slides',
    desc: 'AI writes 6–9 slides (hook → value → CTA), rendered as 1080×1350 PNGs. On LinkedIn post them as a document/PDF carousel.', fields: [TOPIC, AUDIENCE] },
  { key: 'banner', name: 'Profile banner', group: 'Visual', platforms: ['x', 'linkedin', 'youtube'], visual: 'banner', output: 'items',
    desc: 'X header 1500×500 · LinkedIn banner 1584×396 · YouTube channel art 2560×1440 (text inside the 1546×423 safe area).', fields: [{ key: 'focus', label: 'What you do', kind: 'text', placeholder: 'e.g. Bug bounty hunter building a mobile app in public' }] },
  { key: 'post-image', name: 'Post image / quote card', group: 'Visual', platforms: ['instagram', 'x', 'linkedin'], visual: 'post-image', output: 'items',
    desc: 'A clean text card for a key line — IG 1080×1350, X 1600×900, LinkedIn 1200×1200.', fields: [TOPIC] },
];

export const PLATFORM_LIMITS: Record<ToolPlatform, { bio: number; post: number; note: string }> = {
  instagram: { bio: 150, post: 2200, note: 'caption 2,200 · first ~125 chars show before “more” · up to 30 hashtags, 3–8 work best' },
  threads: { bio: 150, post: 500, note: '500 per post · longer ideas become a chain of replies · one topic tag per post · links show as a preview card' },
  x: { bio: 160, post: 280, note: '280 per post (longer with Premium) · links in the first reply reach further' },
  linkedin: { bio: 220, post: 3000, note: 'post 3,000 · first ~210 chars show before “see more” · 3–5 hashtags' },
  youtube: { bio: 1000, post: 5000, note: 'title ≤ 100 (aim ≤ 60) · description 5,000 · first 2 lines show in search' },
};

export const toolsFor = (p: ToolPlatform) => TOOLS.filter(t => t.platforms.includes(p));
