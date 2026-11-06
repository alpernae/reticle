// instrumentation.ts — Next.js runs register() once per server start (dev and prod).
// Node-only startup work (SQLite, starting the OpenCode service) lives in
// instrumentation-node.ts → lib/startup.ts.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
