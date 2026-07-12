import { describe, expect, it } from "vitest";

describe("navigator.locks", () => {
  it("runs exclusive requests for one name in FIFO order", async () => {
    const events: string[] = [];
    const first = navigator.locks.request("rules", async (lock) => {
      events.push(`start:${lock?.name}`);
      await Promise.resolve();
      events.push("end:first");
    });
    const second = navigator.locks.request("rules", () => {
      events.push("start:second");
    });

    await Promise.all([first, second]);

    expect(events).toEqual(["start:rules", "end:first", "start:second"]);
  });

  it("does not make different lock names wait for one another", async () => {
    const events: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    const first = navigator.locks.request("rules", async () => {
      events.push("rules:start");
      await promise;
      events.push("rules:end");
    });
    const second = navigator.locks.request("settings", () => {
      events.push("settings");
      resolve();
    });

    await Promise.all([first, second]);

    expect(events).toEqual(["rules:start", "settings", "rules:end"]);
  });
});
