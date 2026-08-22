import { describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { createV1Seed } from "../core/schema";
import type { SessionState } from "./session-store";
import {
  clearAppliedRevision,
  getAppliedRevision,
  read as readSession,
  setAppliedRevision,
  write as writeSession,
} from "./session-store";
import { read, subscribe, write } from "./store";

describe("platform storage", () => {
  it("round-trips the state document and reports state-key changes", async () => {
    const doc = createV1Seed();
    const onChange = vi.fn();
    const unsubscribe = subscribe(onChange);

    await write(doc);

    expect(await read()).toEqual(doc);
    expect(onChange).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("round-trips session state and the applied revision", async () => {
    const session: SessionState = {
      nextNum: 18,
      tabs: {
        42: [
          {
            num: 17,
            tabId: 42,
            origin: "https://api.example",
            direction: "request",
            operation: "set",
            header: "x-debug",
            value: "enabled",
            enabled: true,
          },
        ],
      },
    };

    expect(await readSession()).toEqual({ nextNum: 1, tabs: {} });
    expect(await getAppliedRevision()).toBeUndefined();

    await Promise.all([
      writeSession(session),
      setAppliedRevision({ dynamic: "abc", session: "123" }),
      setAppliedRevision({ dynamic: "abc", session: "123" }),
    ]);

    expect(await readSession()).toEqual(session);
    expect(await getAppliedRevision()).toEqual({
      dynamic: "abc",
      session: "123",
    });
    await clearAppliedRevision();
    expect(await getAppliedRevision()).toBeUndefined();
  });

  it("cleans malformed session rows and advances stale sequence numbers", async () => {
    await fakeBrowser.storage.session.set({
      sessionState: {
        nextNum: 1,
        tabs: {
          4: [
            {
              num: 7,
              tabId: 4,
              origin: "https://api.example",
              direction: "request",
              operation: "set",
              header: "x-debug",
              value: "enabled",
              enabled: true,
            },
            "not a row",
            {
              num: 8,
              tabId: 4,
              origin: "api.example",
              direction: "request",
              operation: "set",
              header: "x-debug",
              value: "enabled",
              enabled: true,
            },
          ],
          5: "not rows",
        },
      },
    });

    expect(await readSession()).toEqual({
      nextNum: 8,
      tabs: {
        4: [
          {
            num: 7,
            tabId: 4,
            origin: "https://api.example",
            direction: "request",
            operation: "set",
            header: "x-debug",
            value: "enabled",
            enabled: true,
          },
        ],
      },
    });
  });

  it("drops a non-record tab collection", async () => {
    await fakeBrowser.storage.session.set({
      sessionState: { nextNum: 4, tabs: "not tabs" },
    });

    expect(await readSession()).toEqual({ nextNum: 4, tabs: {} });
  });
});
