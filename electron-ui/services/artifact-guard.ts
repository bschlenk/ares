import { AsyncLocalStorage } from 'node:async_hooks';
/** Native job ownership must still hold immediately before file publication. */
export const artifactGuard = new AsyncLocalStorage<() => Promise<void>>();
