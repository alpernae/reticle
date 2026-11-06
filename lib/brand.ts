// lib/brand.ts — the product name in ONE place. Rename here and the sidebar,
// top bar, page title, AI system prompt and footer all follow.
export const BRAND = {
  name: 'Reticle',
  tagline: 'recon for your reach',
  // the long form, for the README banner and the login page
  slogan: 'Find the posts that broke out. Write the next one in your voice.',
  // fixed on purpose: new Date() in the layout breaks prerendering under cacheComponents
  copyrightYear: '2026',
  owner: 'alpernae',
  description: 'Private content-intelligence dashboard: finds outlier posts on X, LinkedIn, Instagram, Threads, TikTok and YouTube, extracts why they won, and drafts posts in your voice.',
} as const;
