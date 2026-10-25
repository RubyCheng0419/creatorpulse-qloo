import { AsyncLocalStorage } from 'node:async_hooks';

// Per-request flags that deep helpers need without threading a parameter through
// every call. Server-only.

interface RequestContext {
  // "Run live": skip every Qloo and YouTube cache read for this request (results are
  // still written back, so this also refreshes the cache).
  bypassCache: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function withRequestContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function bypassCache(): boolean {
  return storage.getStore()?.bypassCache ?? false;
}
