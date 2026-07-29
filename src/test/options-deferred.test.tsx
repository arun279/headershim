// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../entrypoints/options/App";
import { write } from "../platform/store";
import { copy } from "../ui/copy";
import { profile, resetFixtures, stateDoc } from "../ui/test/fixtures";
import { render, settle } from "../ui/test/render";
import { followCurrentBatch, stopFollowingCurrentBatch } from "./applied";

vi.mock("../../entrypoints/options/DeferredPage", () => {
  throw new Error("deferred page unavailable");
});

beforeEach(() => {
  stopFollowingCurrentBatch();
  resetFixtures();
  window.location.hash = "";
});

afterEach(stopFollowingCurrentBatch);

describe("options deferred pages", () => {
  it("shows a load error without reloading the route", async () => {
    await write(stateDoc([profile("p1")]));
    await followCurrentBatch();
    window.location.hash = "#traffic";
    const reload = vi.spyOn(window.location, "reload");

    const root = render(<App />);
    await settle();

    expect(root.textContent).toContain(copy.errors.pageLoad);
    expect(reload).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#traffic");
  });
});
