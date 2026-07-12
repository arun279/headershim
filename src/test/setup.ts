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
