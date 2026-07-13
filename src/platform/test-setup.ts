import { fakeBrowser } from "@webext-core/fake-browser";
import { afterEach, beforeEach, vi } from "vitest";

interface TestPermissions {
  origins?: string[];
}

type PermissionListener = (permissions: TestPermissions) => void;

function createPermissionEvent() {
  const listeners = new Set<PermissionListener>();
  return {
    addListener: (listener: PermissionListener) => listeners.add(listener),
    hasListener: (listener: PermissionListener) => listeners.has(listener),
    hasListeners: () => listeners.size > 0,
    removeListener: (listener: PermissionListener) =>
      listeners.delete(listener),
    trigger: async (permissions: TestPermissions) => {
      await Promise.all(
        [...listeners].map((listener) => listener(permissions)),
      );
    },
  };
}

const grantedOrigins = new Set<string>();
const onAdded = createPermissionEvent();
const onRemoved = createPermissionEvent();

Object.assign(fakeBrowser.permissions, {
  contains: async ({ origins = [] }: TestPermissions) =>
    origins.every((origin) => grantedOrigins.has(origin)),
  getAll: async () => ({ origins: [...grantedOrigins] }),
  onAdded,
  onRemoved,
  remove: async ({ origins = [] }: TestPermissions) => {
    const removed = origins.filter((origin) => grantedOrigins.delete(origin));
    if (removed.length > 0) {
      await onRemoved.trigger({ origins: removed });
    }
    return removed.length > 0;
  },
  request: async ({ origins = [] }: TestPermissions) => {
    const added = origins.filter((origin) => !grantedOrigins.has(origin));
    for (const origin of added) {
      grantedOrigins.add(origin);
    }
    if (added.length > 0) {
      await onAdded.trigger({ origins: added });
    }
    return true;
  },
});

Object.assign(fakeBrowser.declarativeNetRequest, {
  getMatchedRules: async () => ({ rulesMatchedInfo: [] }),
  setExtensionActionOptions: async () => undefined,
});

beforeEach(() => {
  fakeBrowser.reset();
  grantedOrigins.clear();
});

afterEach(() => vi.restoreAllMocks());

class InMemoryLockManager implements LockManager {
  readonly #tails = new Map<string, Promise<void>>();

  query(): Promise<LockManagerSnapshot> {
    return Promise.resolve({});
  }

  request<T>(
    name: string,
    callback: LockGrantedCallback<T>,
  ): Promise<Awaited<T>>;
  request<T>(
    name: string,
    options: LockOptions,
    callback: LockGrantedCallback<T>,
  ): Promise<Awaited<T>>;
  request<T>(
    name: string,
    optionsOrCallback: LockOptions | LockGrantedCallback<T>,
    callback?: LockGrantedCallback<T>,
  ): Promise<Awaited<T>> {
    if (typeof optionsOrCallback === "function") {
      return this.#enqueue(name, optionsOrCallback);
    }
    if (optionsOrCallback.mode === "shared") {
      return Promise.reject(
        new TypeError("Only exclusive locks are supported"),
      );
    }
    if (callback === undefined) {
      return Promise.reject(new TypeError("A lock callback is required"));
    }
    return this.#enqueue(name, callback);
  }

  async #enqueue<T>(
    name: string,
    callback: LockGrantedCallback<T>,
  ): Promise<Awaited<T>> {
    const previous = this.#tails.get(name) ?? Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    const tail = previous.then(() => promise);
    this.#tails.set(name, tail);

    await previous;
    try {
      return await callback({ mode: "exclusive", name });
    } finally {
      resolve();
      if (this.#tails.get(name) === tail) {
        this.#tails.delete(name);
      }
    }
  }
}

Object.defineProperty(navigator, "locks", {
  configurable: true,
  value: new InMemoryLockManager(),
});
