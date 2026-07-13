import { fakeBrowser } from "@webext-core/fake-browser";
import { afterEach, beforeEach, vi } from "vitest";

interface TestPermissions {
  origins?: string[];
}

function createEvent<Args extends unknown[]>() {
  const listeners = new Set<(...args: Args) => void>();
  return {
    addListener: (listener: (...args: Args) => void) => listeners.add(listener),
    hasListener: (listener: (...args: Args) => void) => listeners.has(listener),
    hasListeners: () => listeners.size > 0,
    removeListener: (listener: (...args: Args) => void) =>
      listeners.delete(listener),
    removeAllListeners: () => listeners.clear(),
    trigger: async (...args: Args) => {
      await Promise.all([...listeners].map((listener) => listener(...args)));
    },
  };
}

const grantedOrigins = new Set<string>();
const onAdded = createEvent<[permissions: TestPermissions]>();
const onRemoved = createEvent<[permissions: TestPermissions]>();
const onCommand = createEvent<[command: string]>();

Object.assign(fakeBrowser, { commands: { onCommand } });

Object.assign(fakeBrowser.runtime, {
  getManifest: () => ({ version: "1.0.0" }),
});

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
  onAdded.removeAllListeners();
  onRemoved.removeAllListeners();
  onCommand.removeAllListeners();
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
