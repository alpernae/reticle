// lib/geo.ts — free-text profile location → a map region (client-safe, no network).
//
// Profile locations are messy: "SF ✈️ NYC", "Berlin, Germany", "🇮🇳", "Earth",
// "building in public". We match, in order: flag emoji → country, then known
// cities/hubs, then US states, then country names. Anything else is unknown
// (we never guess). Each region carries a time zone so the map can show when
// its authors post on their own clock.

export type Region = { key: string; label: string; lat: number; lng: number; tz: string; country: string };

// cities / hubs first (more specific than the country)
const CITIES: [RegExp, Region][] = [
  [/\b(sf|s\.f\.|san francisco|bay area|silicon valley|palo alto|mountain view|menlo park|oakland|berkeley|san jose|sunnyvale|cupertino)\b/i, { key: 'us-sf', label: 'SF Bay Area', lat: 37.77, lng: -122.42, tz: 'America/Los_Angeles', country: 'US' }],
  [/\b(nyc|new york|brooklyn|manhattan|ny,? ny)\b/i, { key: 'us-nyc', label: 'New York', lat: 40.71, lng: -74.0, tz: 'America/New_York', country: 'US' }],
  [/\b(los angeles|l\.a\.|santa monica|venice beach)\b|\bLA\b/, { key: 'us-la', label: 'Los Angeles', lat: 34.05, lng: -118.24, tz: 'America/Los_Angeles', country: 'US' }],
  [/\b(seattle|bellevue|redmond)\b/i, { key: 'us-sea', label: 'Seattle', lat: 47.61, lng: -122.33, tz: 'America/Los_Angeles', country: 'US' }],
  [/\b(austin)\b/i, { key: 'us-aus', label: 'Austin', lat: 30.27, lng: -97.74, tz: 'America/Chicago', country: 'US' }],
  [/\b(miami)\b/i, { key: 'us-mia', label: 'Miami', lat: 25.76, lng: -80.19, tz: 'America/New_York', country: 'US' }],
  [/\b(boston|cambridge,? ma)\b/i, { key: 'us-bos', label: 'Boston', lat: 42.36, lng: -71.06, tz: 'America/New_York', country: 'US' }],
  [/\b(chicago)\b/i, { key: 'us-chi', label: 'Chicago', lat: 41.88, lng: -87.63, tz: 'America/Chicago', country: 'US' }],
  [/\b(denver|boulder)\b/i, { key: 'us-den', label: 'Denver', lat: 39.74, lng: -104.99, tz: 'America/Denver', country: 'US' }],
  [/\b(toronto)\b/i, { key: 'ca-tor', label: 'Toronto', lat: 43.65, lng: -79.38, tz: 'America/Toronto', country: 'CA' }],
  [/\b(vancouver)\b/i, { key: 'ca-van', label: 'Vancouver', lat: 49.28, lng: -123.12, tz: 'America/Vancouver', country: 'CA' }],
  [/\b(london)\b/i, { key: 'gb-lon', label: 'London', lat: 51.51, lng: -0.13, tz: 'Europe/London', country: 'GB' }],
  [/\b(berlin)\b/i, { key: 'de-ber', label: 'Berlin', lat: 52.52, lng: 13.4, tz: 'Europe/Berlin', country: 'DE' }],
  [/\b(munich|münchen)\b/i, { key: 'de-muc', label: 'Munich', lat: 48.14, lng: 11.58, tz: 'Europe/Berlin', country: 'DE' }],
  [/\b(paris)\b/i, { key: 'fr-par', label: 'Paris', lat: 48.86, lng: 2.35, tz: 'Europe/Paris', country: 'FR' }],
  [/\b(amsterdam)\b/i, { key: 'nl-ams', label: 'Amsterdam', lat: 52.37, lng: 4.9, tz: 'Europe/Amsterdam', country: 'NL' }],
  [/\b(barcelona)\b/i, { key: 'es-bcn', label: 'Barcelona', lat: 41.39, lng: 2.17, tz: 'Europe/Madrid', country: 'ES' }],
  [/\b(madrid)\b/i, { key: 'es-mad', label: 'Madrid', lat: 40.42, lng: -3.7, tz: 'Europe/Madrid', country: 'ES' }],
  [/\b(lisbon|lisboa)\b/i, { key: 'pt-lis', label: 'Lisbon', lat: 38.72, lng: -9.14, tz: 'Europe/Lisbon', country: 'PT' }],
  [/\b(stockholm)\b/i, { key: 'se-sto', label: 'Stockholm', lat: 59.33, lng: 18.07, tz: 'Europe/Stockholm', country: 'SE' }],
  [/\b(zurich|zürich)\b/i, { key: 'ch-zrh', label: 'Zurich', lat: 47.38, lng: 8.54, tz: 'Europe/Zurich', country: 'CH' }],
  [/\b(dublin)\b/i, { key: 'ie-dub', label: 'Dublin', lat: 53.35, lng: -6.26, tz: 'Europe/Dublin', country: 'IE' }],
  [/\b(istanbul|İstanbul|ankara|izmir|İzmir)\b/i, { key: 'tr-ist', label: 'Istanbul', lat: 41.01, lng: 28.98, tz: 'Europe/Istanbul', country: 'TR' }],
  [/\b(dubai|abu dhabi)\b/i, { key: 'ae-dxb', label: 'Dubai', lat: 25.2, lng: 55.27, tz: 'Asia/Dubai', country: 'AE' }],
  [/\b(bangalore|bengaluru)\b/i, { key: 'in-blr', label: 'Bengaluru', lat: 12.97, lng: 77.59, tz: 'Asia/Kolkata', country: 'IN' }],
  [/\b(mumbai|bombay|pune)\b/i, { key: 'in-bom', label: 'Mumbai', lat: 19.08, lng: 72.88, tz: 'Asia/Kolkata', country: 'IN' }],
  [/\b(delhi|new delhi|gurgaon|gurugram|noida)\b/i, { key: 'in-del', label: 'Delhi NCR', lat: 28.61, lng: 77.21, tz: 'Asia/Kolkata', country: 'IN' }],
  [/\b(hyderabad)\b/i, { key: 'in-hyd', label: 'Hyderabad', lat: 17.39, lng: 78.49, tz: 'Asia/Kolkata', country: 'IN' }],
  [/\b(singapore)\b/i, { key: 'sg', label: 'Singapore', lat: 1.35, lng: 103.82, tz: 'Asia/Singapore', country: 'SG' }],
  [/\b(hong kong)\b/i, { key: 'hk', label: 'Hong Kong', lat: 22.32, lng: 114.17, tz: 'Asia/Hong_Kong', country: 'HK' }],
  [/\b(tokyo)\b/i, { key: 'jp-tyo', label: 'Tokyo', lat: 35.68, lng: 139.69, tz: 'Asia/Tokyo', country: 'JP' }],
  [/\b(seoul)\b/i, { key: 'kr-sel', label: 'Seoul', lat: 37.57, lng: 126.98, tz: 'Asia/Seoul', country: 'KR' }],
  [/\b(sydney)\b/i, { key: 'au-syd', label: 'Sydney', lat: -33.87, lng: 151.21, tz: 'Australia/Sydney', country: 'AU' }],
  [/\b(melbourne)\b/i, { key: 'au-mel', label: 'Melbourne', lat: -37.81, lng: 144.96, tz: 'Australia/Melbourne', country: 'AU' }],
  [/\b(lagos)\b/i, { key: 'ng-los', label: 'Lagos', lat: 6.52, lng: 3.38, tz: 'Africa/Lagos', country: 'NG' }],
  [/\b(nairobi)\b/i, { key: 'ke-nbo', label: 'Nairobi', lat: -1.29, lng: 36.82, tz: 'Africa/Nairobi', country: 'KE' }],
  [/\b(são paulo|sao paulo)\b/i, { key: 'br-sao', label: 'São Paulo', lat: -23.55, lng: -46.63, tz: 'America/Sao_Paulo', country: 'BR' }],
  [/\b(buenos aires)\b/i, { key: 'ar-bue', label: 'Buenos Aires', lat: -34.6, lng: -58.38, tz: 'America/Argentina/Buenos_Aires', country: 'AR' }],
  [/\b(mexico city|cdmx)\b/i, { key: 'mx-mex', label: 'Mexico City', lat: 19.43, lng: -99.13, tz: 'America/Mexico_City', country: 'MX' }],
  [/\b(tel aviv)\b/i, { key: 'il-tlv', label: 'Tel Aviv', lat: 32.09, lng: 34.78, tz: 'Asia/Jerusalem', country: 'IL' }],
];

const COUNTRIES: Record<string, Omit<Region, 'country'> & { names: RegExp }> = {
  US: { key: 'us', label: 'United States', lat: 39.5, lng: -98.35, tz: 'America/Chicago', names: /\b(usa|u\.s\.a?\.?|united states|america)\b/i },
  CA: { key: 'ca', label: 'Canada', lat: 56.1, lng: -106.3, tz: 'America/Toronto', names: /\bcanada\b/i },
  MX: { key: 'mx', label: 'Mexico', lat: 23.6, lng: -102.5, tz: 'America/Mexico_City', names: /\bmexico\b/i },
  BR: { key: 'br', label: 'Brazil', lat: -14.2, lng: -51.9, tz: 'America/Sao_Paulo', names: /\b(brazil|brasil)\b/i },
  AR: { key: 'ar', label: 'Argentina', lat: -38.4, lng: -63.6, tz: 'America/Argentina/Buenos_Aires', names: /\bargentina\b/i },
  GB: { key: 'gb', label: 'United Kingdom', lat: 54.0, lng: -2.0, tz: 'Europe/London', names: /\b(uk|u\.k\.|united kingdom|england|scotland|wales|britain)\b/i },
  IE: { key: 'ie', label: 'Ireland', lat: 53.4, lng: -8.2, tz: 'Europe/Dublin', names: /\bireland\b/i },
  DE: { key: 'de', label: 'Germany', lat: 51.2, lng: 10.45, tz: 'Europe/Berlin', names: /\b(germany|deutschland)\b/i },
  FR: { key: 'fr', label: 'France', lat: 46.2, lng: 2.2, tz: 'Europe/Paris', names: /\bfrance\b/i },
  NL: { key: 'nl', label: 'Netherlands', lat: 52.1, lng: 5.3, tz: 'Europe/Amsterdam', names: /\b(netherlands|holland|nederland)\b/i },
  ES: { key: 'es', label: 'Spain', lat: 40.5, lng: -3.7, tz: 'Europe/Madrid', names: /\b(spain|españa)\b/i },
  PT: { key: 'pt', label: 'Portugal', lat: 39.4, lng: -8.2, tz: 'Europe/Lisbon', names: /\bportugal\b/i },
  IT: { key: 'it', label: 'Italy', lat: 41.9, lng: 12.6, tz: 'Europe/Rome', names: /\b(italy|italia)\b/i },
  CH: { key: 'ch', label: 'Switzerland', lat: 46.8, lng: 8.2, tz: 'Europe/Zurich', names: /\bswitzerland\b/i },
  SE: { key: 'se', label: 'Sweden', lat: 60.1, lng: 18.6, tz: 'Europe/Stockholm', names: /\bsweden\b/i },
  NO: { key: 'no', label: 'Norway', lat: 60.5, lng: 8.5, tz: 'Europe/Oslo', names: /\bnorway\b/i },
  DK: { key: 'dk', label: 'Denmark', lat: 56.3, lng: 9.5, tz: 'Europe/Copenhagen', names: /\bdenmark\b/i },
  FI: { key: 'fi', label: 'Finland', lat: 61.9, lng: 25.7, tz: 'Europe/Helsinki', names: /\bfinland\b/i },
  PL: { key: 'pl', label: 'Poland', lat: 51.9, lng: 19.1, tz: 'Europe/Warsaw', names: /\bpoland\b/i },
  UA: { key: 'ua', label: 'Ukraine', lat: 48.4, lng: 31.2, tz: 'Europe/Kyiv', names: /\bukraine\b/i },
  TR: { key: 'tr', label: 'Türkiye', lat: 39.0, lng: 35.2, tz: 'Europe/Istanbul', names: /\b(turkey|türkiye|turkiye)\b/i },
  IL: { key: 'il', label: 'Israel', lat: 31.0, lng: 34.9, tz: 'Asia/Jerusalem', names: /\bisrael\b/i },
  AE: { key: 'ae', label: 'UAE', lat: 23.4, lng: 53.8, tz: 'Asia/Dubai', names: /\b(uae|united arab emirates)\b/i },
  SA: { key: 'sa', label: 'Saudi Arabia', lat: 23.9, lng: 45.1, tz: 'Asia/Riyadh', names: /\bsaudi\b/i },
  EG: { key: 'eg', label: 'Egypt', lat: 26.8, lng: 30.8, tz: 'Africa/Cairo', names: /\begypt\b/i },
  NG: { key: 'ng', label: 'Nigeria', lat: 9.1, lng: 8.7, tz: 'Africa/Lagos', names: /\bnigeria\b/i },
  KE: { key: 'ke', label: 'Kenya', lat: -0.02, lng: 37.9, tz: 'Africa/Nairobi', names: /\bkenya\b/i },
  ZA: { key: 'za', label: 'South Africa', lat: -30.6, lng: 22.9, tz: 'Africa/Johannesburg', names: /\bsouth africa\b/i },
  IN: { key: 'in', label: 'India', lat: 21.0, lng: 78.0, tz: 'Asia/Kolkata', names: /\b(india|bharat)\b/i },
  PK: { key: 'pk', label: 'Pakistan', lat: 30.4, lng: 69.3, tz: 'Asia/Karachi', names: /\bpakistan\b/i },
  BD: { key: 'bd', label: 'Bangladesh', lat: 23.7, lng: 90.4, tz: 'Asia/Dhaka', names: /\bbangladesh\b/i },
  VN: { key: 'vn', label: 'Vietnam', lat: 14.1, lng: 108.3, tz: 'Asia/Ho_Chi_Minh', names: /\b(vietnam|viet nam)\b/i },
  TH: { key: 'th', label: 'Thailand', lat: 15.9, lng: 100.99, tz: 'Asia/Bangkok', names: /\bthailand\b/i },
  ID: { key: 'id', label: 'Indonesia', lat: -0.8, lng: 113.9, tz: 'Asia/Jakarta', names: /\b(indonesia|bali|jakarta)\b/i },
  PH: { key: 'ph', label: 'Philippines', lat: 12.9, lng: 121.8, tz: 'Asia/Manila', names: /\bphilippines\b/i },
  CN: { key: 'cn', label: 'China', lat: 35.9, lng: 104.2, tz: 'Asia/Shanghai', names: /\b(china|shanghai|beijing|shenzhen)\b/i },
  JP: { key: 'jp', label: 'Japan', lat: 36.2, lng: 138.3, tz: 'Asia/Tokyo', names: /\bjapan\b/i },
  KR: { key: 'kr', label: 'South Korea', lat: 35.9, lng: 127.8, tz: 'Asia/Seoul', names: /\b(south korea|korea)\b/i },
  AU: { key: 'au', label: 'Australia', lat: -25.3, lng: 133.8, tz: 'Australia/Sydney', names: /\baustralia\b/i },
  NZ: { key: 'nz', label: 'New Zealand', lat: -40.9, lng: 174.9, tz: 'Pacific/Auckland', names: /\bnew zealand\b/i },
  SG: { key: 'sg', label: 'Singapore', lat: 1.35, lng: 103.82, tz: 'Asia/Singapore', names: /\bsingapore\b/i },
  HK: { key: 'hk', label: 'Hong Kong', lat: 22.32, lng: 114.17, tz: 'Asia/Hong_Kong', names: /\bhong kong\b/i },
};

// US states → the US (by name or ", XX" abbreviation)
const US_STATES = /\b(california|texas|florida|washington|oregon|colorado|utah|arizona|nevada|georgia|virginia|massachusetts|illinois|ohio|michigan|pennsylvania|north carolina|new jersey|tennessee|minnesota|wisconsin)\b|,\s*(CA|TX|FL|WA|OR|CO|UT|AZ|NV|GA|VA|MA|IL|OH|MI|PA|NC|NJ|TN|MN|WI|NY)\b/;

const country = (code: string): Region | null => {
  const c = COUNTRIES[code];
  return c ? { key: c.key, label: c.label, lat: c.lat, lng: c.lng, tz: c.tz, country: code } : null;
};

/** Regional-indicator flag emoji (🇮🇳) → ISO code. */
function flagCode(s: string): string | null {
  const m = s.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
  if (!m) return null;
  return [...m[0]].map(c => String.fromCharCode(c.codePointAt(0)! - 0x1f1e6 + 65)).join('');
}

/** Match a free-text location; null when it isn't a place we know. */
export function geocode(raw?: string | null): Region | null {
  const s = (raw || '').trim();
  if (!s) return null;
  for (const [rx, r] of CITIES) if (rx.test(s)) return r;
  if (US_STATES.test(s)) return country('US');
  for (const [code, c] of Object.entries(COUNTRIES)) if (c.names.test(s)) return country(code);
  const f = flagCode(s);
  if (f) return country(f);
  return null;
}

// ---------------- aggregation for the Overview planet ----------------
export type GeoPost = { source: string; author?: string; authorLocation?: string; created: number; outlier: number; title: string; link: string };
export type GeoRegion = Region & {
  n: number;                 // posts
  authors: { name: string; n: number; source: string }[]; // top authors (most posts first)
  authorCount: number;
  lift: number;              // median outlier here ÷ median outlier overall
  winRate: number;           // % of posts that beat the creator's normal 2×+
  hours: number[];           // posts by hour of day, on the REGION's clock
  winHours: number[];        // winners by hour, region clock
  sources: Record<string, number>;
  top: { title: string; link: string; outlier: number; created: number; author?: string } | null;
  raw: string[];             // a few of the original location strings (to show what matched)
};

const med = (v: number[]) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const hourIn = (() => {
  const cache = new Map<string, Intl.DateTimeFormat>();
  return (ts: number, tz: string) => {
    let f = cache.get(tz);
    if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }); cache.set(tz, f); }
    return Number(f.formatToParts(ts).find(p => p.type === 'hour')?.value || 0) % 24;
  };
})();

/** Group posts by where their author says they are. */
export function geoRegions(posts: GeoPost[]): { regions: GeoRegion[]; located: number; unknown: number; noLocation: number } {
  const overall = med(posts.map(p => p.outlier)) || 1;
  const map = new Map<string, { r: Region; posts: GeoPost[]; raw: Set<string> }>();
  let unknown = 0, noLocation = 0;
  for (const p of posts) {
    if (!p.authorLocation) { noLocation++; continue; }
    const r = geocode(p.authorLocation);
    if (!r) { unknown++; continue; }
    const g = map.get(r.key) || map.set(r.key, { r, posts: [], raw: new Set() }).get(r.key)!;
    g.posts.push(p); if (g.raw.size < 4) g.raw.add(p.authorLocation);
  }
  const regions: GeoRegion[] = [...map.values()].map(({ r, posts: ps, raw }) => {
    const byAuthor = new Map<string, { n: number; source: string }>();
    for (const p of ps) if (p.author) { const a = byAuthor.get(p.author) || { n: 0, source: p.source }; a.n++; byAuthor.set(p.author, a); }
    const hours = new Array(24).fill(0), winHours = new Array(24).fill(0);
    const sources: Record<string, number> = {};
    for (const p of ps) { const h = hourIn(p.created, r.tz); hours[h]++; if (p.outlier >= 2) winHours[h]++; sources[p.source] = (sources[p.source] || 0) + 1; }
    const best = [...ps].sort((a, b) => b.outlier - a.outlier)[0];
    return {
      ...r, n: ps.length,
      authors: [...byAuthor].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.n - a.n).slice(0, 5),
      authorCount: byAuthor.size,
      lift: Math.round(med(ps.map(p => p.outlier)) / overall * 100) / 100,
      winRate: Math.round(ps.filter(p => p.outlier >= 2).length / ps.length * 100),
      hours, winHours, sources,
      top: best ? { title: best.title.slice(0, 160), link: best.link, outlier: best.outlier, created: best.created, author: best.author } : null,
      raw: [...raw],
    };
  }).sort((a, b) => b.n - a.n);
  return { regions, located: regions.reduce((s, r) => s + r.n, 0), unknown, noLocation };
}
