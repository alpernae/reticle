// instrumentation-node.ts — Node.js-only startup work, imported by instrumentation.ts
// (the layout the Next.js instrumentation guide recommends).
import { onServerStart, startScheduler } from './lib/startup';

onServerStart();
startScheduler();
