// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { atPaint, paint } from "./render";

// An atPaint whose commit never arrives keeps its observer armed, and that
// observer watches the whole document, so it would otherwise run `observe`
// against whatever the next test paints. These two tests run in order in one
// file, which is the only place the carry-over can be seen.
let observed = false;

it("arms an atPaint whose commit never comes", () => {
  void atPaint(
    () => document.querySelector("main") !== null,
    () => {
      observed = true;
    },
  );
  paint(<section />);
});

it("does not inherit the previous test's observer", async () => {
  paint(<main />);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(observed).toBe(false);
});
