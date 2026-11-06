// lib/scans.ts — X topic-scan presets (client-safe). A topic scan searches ALL of
// X for posts that already won (min_faves) on a theme, instead of following
// specific accounts — the fastest way to learn a niche's winning formats.
// The server appends: min_faves:N -filter:replies -filter:nativeretweets since:<date>.
//
// Query shape matters: X's "Top" search returned NOTHING for a single big
// OR-group of bare terms (tested 2026-11-04), but works reliably with two
// AND-ed groups: (topic terms) (action/outcome terms). Keep presets that shape.
export type TopicPreset = { key: string; label: string; query: string; minFaves: number };

export const TOPIC_PRESETS: TopicPreset[] = [
  { key: 'mobile', label: 'Mobile apps', minFaves: 100,
    query: '("App Store" OR "Play Store" OR "my app" OR "iOS app" OR "Android app" OR "mobile app" OR SwiftUI OR Flutter OR "React Native") (launched OR downloads OR users OR revenue OR built OR shipped OR tip) lang:en' },
  { key: 'ai-tips', label: 'AI tools & tips', minFaves: 200,
    query: '("you can now" OR "have you tried" OR "for free" OR "new feature" OR "pro tip" OR "is now available") (Claude OR Codex OR Cursor OR OpenCode OR Gemini OR GPT OR GLM OR "Claude Code" OR Copilot) lang:en' },
  { key: 'saas', label: 'SaaS & startups', minFaves: 150,
    query: '(MRR OR SaaS OR "paying customers" OR "indie hacker" OR bootstrapped) (launched OR revenue OR customers OR built OR growth OR lesson) lang:en' },
  { key: 'security', label: 'Security & bug bounty', minFaves: 100,
    query: '("bug bounty" OR bugbounty OR IDOR OR XSS OR SSRF OR pentest OR "security tip") (found OR bounty OR tip OR report OR payload OR bypass) lang:en' },
];
