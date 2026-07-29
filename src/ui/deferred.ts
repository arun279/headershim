const pending = new Set<Promise<unknown>>();

export function loadDeferred<T>(load: () => Promise<T>): Promise<T> {
  const request = load();
  pending.add(request);
  void request.then(
    () => pending.delete(request),
    () => pending.delete(request),
  );
  return request;
}

export async function settleDeferred(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled(pending);
  }
}
