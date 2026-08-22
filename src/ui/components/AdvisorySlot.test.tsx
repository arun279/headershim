// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { copy, sentenceText } from "../copy";
import { render } from "../test/render";
import { AdvisorySlot } from "./AdvisorySlot";

describe("AdvisorySlot", () => {
  it("renders nothing for an ordinary header", () => {
    const root = render(
      <AdvisorySlot header="x-debug" direction="request" operation="set" />,
    );
    expect(root.children).toHaveLength(0);
  });

  it("pairs the caution word and icon with the te transport advisory", () => {
    const root = render(
      <AdvisorySlot header="te" direction="request" operation="set" />,
    );
    const advisory = root.querySelector(".advisory-slot");
    expect(advisory?.getAttribute("aria-label")).toBe(
      copy.headerFields.caution,
    );
    expect(advisory?.querySelector(".advisory-icon")?.textContent).toBe("▲");
    expect(advisory?.textContent).toContain(copy.advisories.te);
  });

  it.each([
    { header: "connection", expected: copy.advisories.h1Only },
    { header: "transfer-encoding", expected: copy.advisories.h1Only },
    { header: "keep-alive", expected: copy.advisories.h2Breaking },
    { header: "upgrade", expected: copy.advisories.h2Breaking },
    { header: "content-length", expected: copy.advisories.contentLength },
    { header: "host", expected: copy.advisories.host },
  ])(
    "states the measured transport sentence for a $header request rule",
    ({ header, expected }) => {
      const root = render(
        <AdvisorySlot header={header} direction="request" operation="set" />,
      );
      expect(root.textContent).toContain(expected);
    },
  );

  it("stays quiet for trailer, which reaches the wire on both transports", () => {
    const root = render(
      <AdvisorySlot header="trailer" direction="request" operation="set" />,
    );
    expect(root.children).toHaveLength(0);
  });

  it("stays quiet about transports on the response side, where nothing is measured", () => {
    const root = render(
      <AdvisorySlot header="connection" direction="response" operation="set" />,
    );
    expect(root.children).toHaveLength(0);
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

  it("notes a removal from a response security policy", () => {
    const root = render(
      <AdvisorySlot
        header="content-security-policy"
        direction="response"
        operation="remove"
      />,
    );
    expect(root.textContent).toContain(copy.advisories.securityResponse);
  });

  it("notes an append to a response security policy", () => {
    const root = render(
      <AdvisorySlot
        header="content-security-policy"
        direction="response"
        operation="append"
      />,
    );
    expect(root.textContent).toContain(copy.advisories.securityResponse);
  });

  it("names the side when a response header is set on the request direction", () => {
    const root = render(
      <AdvisorySlot
        header="content-security-policy"
        direction="request"
        operation="set"
      />,
    );
    expect(root.textContent).toContain(copy.advisories.responseOnRequest);
    expect(root.textContent).not.toContain(copy.advisories.securityResponse);
  });

  it("cautions on a credential planted by a response, not just sent by a request", () => {
    const root = render(
      <AdvisorySlot header="set-cookie" direction="response" operation="set" />,
    );
    expect(root.textContent).toContain(copy.advisories.credential);
  });

  it("warns while a URL pattern carries no || host anchor", () => {
    const root = render(
      <AdvisorySlot
        header="x-debug"
        direction="request"
        operation="set"
        pattern="example.com/"
      />,
    );
    expect(root.textContent).toContain(
      sentenceText(copy.advisories.unanchoredPattern),
    );
  });

  it("stays quiet once the pattern is anchored with ||", () => {
    const root = render(
      <AdvisorySlot
        header="x-debug"
        direction="request"
        operation="set"
        pattern="||example.com/"
      />,
    );
    expect(root.children).toHaveLength(0);
  });
});
