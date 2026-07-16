// @vitest-environment happy-dom
import { useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import type { SystemStatus } from "../../core/status";
import { fire, render } from "../test/render";
import { Annunciator } from "./Annunciator";

function mount(
  status: SystemStatus,
  temporaryCount = 0,
  activeProfileCount = status.kind === "live" ? status.profileCount : 1,
) {
  const onResume = vi.fn();
  const onGrantAccess = vi.fn();
  const root = render(
    <Annunciator
      status={status}
      temporaryCount={temporaryCount}
      activeProfileCount={activeProfileCount}
      onResume={onResume}
      onGrantAccess={onGrantAccess}
    />,
  );
  const strip = root.querySelector(".annunciator") as HTMLElement;
  return { root, strip, onResume, onGrantAccess };
}

const needsAccess: SystemStatus = {
  kind: "needs-access",
  ruleCount: 2,
  hosts: ["api.example.com", "app.example.com", "cdn.example.com"],
};

describe("Annunciator states", () => {
  it("renders paused with a Resume verb on a panel strip", () => {
    const { strip, onResume } = mount({ kind: "paused" }, 0, 3);
    expect(strip.textContent).toContain(
      "Paused · no headers are being modified",
    );
    expect(strip.textContent).not.toContain("profiles on");
    expect(strip.querySelector("strong")?.textContent).toBe("Paused");

    const resume = strip.querySelector("button") as HTMLButtonElement;
    expect(resume.textContent).toBe("Resume");
    fire(() => resume.click());
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("names the first host, counts the rest, and wires the Grant access verb", () => {
    const { strip, onGrantAccess } = mount(needsAccess);
    expect(strip.textContent).toBe(
      "Needs access · 2 rules need api.example.com and 2 more sitesGrant access",
    );
    expect(strip.querySelector("strong")?.textContent).toBe("Needs access");

    fire(() => (strip.querySelector("button") as HTMLButtonElement).click());
    expect(onGrantAccess).toHaveBeenCalledTimes(1);
  });

  it("keeps the count in sans prose and renders the host in the data face", () => {
    const { strip } = mount(needsAccess);
    const data = [...strip.querySelectorAll(".mono")];
    expect(data.map((part) => part.textContent)).toEqual(["api.example.com"]);
    expect(data[0]?.textContent).not.toContain("2");
  });

  it("renders a single missing site without a rest count", () => {
    const { strip } = mount({
      kind: "needs-access",
      ruleCount: 1,
      hosts: ["app.acme.dev"],
    });
    expect(strip.textContent).toBe(
      "Needs access · 1 rule needs app.acme.devGrant access",
    );
  });

  it("labels the all-sites origin instead of echoing the pattern", () => {
    const { strip } = mount({
      kind: "needs-access",
      ruleCount: 1,
      hosts: ["*://*/*"],
    });
    expect(strip.textContent).toContain("needs all sites");
  });

  it("renders the out-of-sync health state without a verb", () => {
    const { strip } = mount({ kind: "out-of-sync" });
    expect(strip.querySelector("strong")?.textContent).toBe("Out of sync");
    expect(strip.textContent).toContain("Any edit retries it.");
    expect(strip.querySelector("button")).toBeNull();
  });

  it("names the enabled/configured split with the temporary detail", () => {
    const { strip } = mount(
      { kind: "live", ruleCount: 2, totalRuleCount: 3, profileCount: 2 },
      1,
    );
    expect(strip.textContent).toBe(
      "On · 2 of 3 rules enabled · 1 temporary on this tab · 2 profiles on",
    );
  });

  it("states the active-profile count alongside a caution state", () => {
    const { strip } = mount(needsAccess, 0, 3);
    expect(strip.textContent).toContain("3 profiles on");
  });

  it("reads live-with-no-rules honestly", () => {
    const { strip } = mount({
      kind: "live",
      ruleCount: 0,
      totalRuleCount: 0,
      profileCount: 1,
    });
    expect(strip.textContent).toBe("No rules yet");
    expect(strip.querySelector("strong")).toBeNull();
    expect(strip.getAttribute("data-live")).toBeNull();
  });

  it("never claims 'no rules yet' while a This-tab override is modifying traffic", () => {
    const { strip } = mount(
      { kind: "live", ruleCount: 0, totalRuleCount: 2, profileCount: 1 },
      1,
    );
    expect(strip.textContent).toBe(
      "On · 0 of 2 rules enabled · 1 temporary on this tab",
    );
  });

  it("renders off when no profile is on", () => {
    const { strip } = mount({ kind: "off" });
    expect(strip.textContent).toBe("Off · no profiles are on");
    expect(strip.querySelector("button")).toBeNull();
  });

  it("hides the lamp from assistive tech", () => {
    const { strip } = mount({ kind: "off" });
    expect(strip.querySelector(".lamp")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});

describe("Annunciator alert-once per popup open", () => {
  const live: SystemStatus = {
    kind: "live",
    ruleCount: 1,
    totalRuleCount: 1,
    profileCount: 1,
  };

  function Harness({ initial }: { initial: SystemStatus }) {
    const [status, setStatus] = useState(initial);
    harnessSetStatus = setStatus;
    return (
      <Annunciator
        status={status}
        temporaryCount={0}
        activeProfileCount={status.kind === "live" ? status.profileCount : 1}
        onResume={() => {}}
        onGrantAccess={() => {}}
      />
    );
  }

  it("asserts on the first caution appearance and is polite thereafter", () => {
    const root = render(<Harness initial={live} />);
    const strip = () => root.querySelector(".annunciator") as HTMLElement;
    expect(strip().getAttribute("role")).toBe("status");

    fire(() => harnessSetStatus(needsAccess));
    expect(strip().getAttribute("role")).toBe("alert");

    // Any later render of the same caution state stays polite.
    fire(() => harnessSetStatus({ ...needsAccess, ruleCount: 3 }));
    expect(strip().getAttribute("role")).toBe("status");

    // Leaving and re-entering the state within one popup open stays polite.
    fire(() => harnessSetStatus(live));
    fire(() => harnessSetStatus(needsAccess));
    expect(strip().getAttribute("role")).toBe("status");
  });

  it("asserts again on a fresh mount, once per caution kind", () => {
    const { strip } = mount({ kind: "out-of-sync" });
    expect(strip.getAttribute("role")).toBe("alert");
  });
});

let harnessSetStatus: (status: SystemStatus) => void;
