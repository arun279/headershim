// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { copy } from "../copy";
import { render } from "../test/render";
import { AdvisorySlot } from "./AdvisorySlot";

describe("AdvisorySlot", () => {
  it("renders nothing for an ordinary header", () => {
    const root = render(
      <AdvisorySlot header="x-debug" direction="request" operation="set" />,
    );
    expect(root.children).toHaveLength(0);
  });

  it("pairs the caution word and icon with the managed-header advisory", () => {
    const root = render(
      <AdvisorySlot header="te" direction="request" operation="set" />,
    );
    const advisory = root.querySelector(".advisory-slot");
    expect(advisory?.getAttribute("aria-label")).toBe(copy.editor.caution);
    expect(advisory?.querySelector(".advisory-icon")?.textContent).toBe("▲");
    expect(advisory?.textContent).toContain(copy.advisories.managedHeader);
  });

  it("cautions that a written credential rides every request the rule reaches", () => {
    const root = render(
      <AdvisorySlot
        header="authorization"
        direction="request"
        operation="set"
      />,
    );
    expect(root.textContent).toContain(copy.advisories.credential);
  });

  it("stays quiet when a rule strips a credential rather than sending one", () => {
    const root = render(
      <AdvisorySlot
        header="authorization"
        direction="request"
        operation="remove"
      />,
    );
    expect(root.children).toHaveLength(0);
  });

  it("cautions that removing a response protection disarms it", () => {
    const root = render(
      <AdvisorySlot
        header="content-security-policy"
        direction="response"
        operation="remove"
      />,
    );
    expect(root.textContent).toContain(copy.advisories.securityResponse);
  });

  it("stays quiet for an append, which can only add a further constraint", () => {
    const root = render(
      <AdvisorySlot
        header="content-security-policy"
        direction="response"
        operation="append"
      />,
    );
    expect(root.children).toHaveLength(0);
  });

  it("cautions on a credential planted by a response, not just sent by a request", () => {
    const root = render(
      <AdvisorySlot header="set-cookie" direction="response" operation="set" />,
    );
    expect(root.textContent).toContain(copy.advisories.credential);
  });
});
