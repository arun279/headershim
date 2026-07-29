import { execFileSync } from "node:child_process";
import { expect, PROFILE_PREFIX, test } from "../fixtures";

// Every process of a browser this suite launched carries the profile directory
// it was started with, and its own role, on its command line. -ww is what stops
// ps truncating the line before either one.
const profileArg = new RegExp(`--user-data-dir=\\S*${PROFILE_PREFIX}`);

function childProcessTypes(): string[] {
  return execFileSync("ps", ["-eww", "-o", "command="], { encoding: "utf8" })
    .split("\n")
    .filter((line) => profileArg.test(line))
    .flatMap((line) => /--type=([a-z-]+)/.exec(line)?.[1] ?? []);
}

// Chromium ignores launch switches it does not recognise, so a build that
// renamed or dropped --in-process-gpu would go back to spawning a GPU process
// for every test browser and no test would fail. The process table is the only
// place that would show it.
test("test browsers run the GPU service inside the browser process", async ({
  context,
}) => {
  // A page of this test's own, so the control below has a renderer to find.
  await context.newPage();

  const types = childProcessTypes();
  // Finding the renderer is what makes the empty GPU list mean something: a
  // scan that matched nothing at all would otherwise read the same way.
  expect(types).toContain("renderer");
  expect(types.filter((type) => type.startsWith("gpu"))).toEqual([]);
});
