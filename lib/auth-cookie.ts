// lib/auth-cookie.ts — the session cookie's name, in its own import-free file
// so proxy.ts (which should stay self-contained per the Next docs) can use it
// without pulling in the database or crypto stack.
export const COOKIE = 'sf_ses';
