import { describe, expect, it } from "vitest";
import { decodeJwtExp, maskToken, tokenFreshness } from "./token";

function base64url(value: object): string {
  return btoa(JSON.stringify(value))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function jwt(payload: Record<string, unknown>): string {
  return `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url(payload)}.sig`;
}

const HOUR = 3_600_000;

describe("maskToken", () => {
  it("splits a scheme, hides the length, and keeps only the last four", () => {
    expect(maskToken("Bearer abcdef1234wxyz")).toEqual({
      scheme: "Bearer",
      last4: "wxyz",
      hasTail: true,
    });
  });

  it("masks a credential too short to reveal a tail", () => {
    expect(maskToken("Bearer abc")).toEqual({
      scheme: "Bearer",
      last4: "abc",
      hasTail: false,
    });
  });

  it("handles a value with no scheme word", () => {
    expect(maskToken("sk_live_0001")).toEqual({ last4: "0001", hasTail: true });
  });
});

describe("decodeJwtExp", () => {
  it("reads exp and iat from a Bearer JWT payload", () => {
    const token = jwt({ exp: 1000, iat: 100 });
    expect(decodeJwtExp(`Bearer ${token}`)).toEqual({
      expMs: 1_000_000,
      iatMs: 100_000,
    });
  });

  it("returns undefined for a non-three-segment token", () => {
    expect(decodeJwtExp("Bearer opaque-value")).toBeUndefined();
  });

  it("returns undefined for a JWT without a numeric exp", () => {
    expect(decodeJwtExp(jwt({ sub: "abc" }))).toBeUndefined();
  });

  it("returns undefined for a malformed payload segment", () => {
    expect(decodeJwtExp("aaa.%%%.ccc")).toBeUndefined();
  });
});

describe("tokenFreshness", () => {
  it("counts down from a JWT with a fractional bar when iat is present", () => {
    const now = 0;
    const fresh = tokenFreshness(
      `Bearer ${jwt({ iat: -HOUR / 1000, exp: (3 * HOUR) / 1000 })}`,
      now,
    );
    expect(fresh).toMatchObject({
      kind: "countdown",
      warn: false,
      expired: false,
    });
    if (fresh.kind === "countdown") {
      expect(fresh.remainingMs).toBe(3 * HOUR);
      expect(fresh.fraction).toBeCloseTo(0.75, 2);
    }
  });

  it("warns as the deadline nears", () => {
    const fresh = tokenFreshness(`Bearer ${jwt({ exp: 8 * 60 })}`, 0);
    expect(fresh).toMatchObject({
      kind: "countdown",
      warn: true,
      expired: false,
    });
  });

  it("reports an expired token with zero remaining", () => {
    const fresh = tokenFreshness(`Bearer ${jwt({ exp: -60 })}`, 0);
    expect(fresh).toMatchObject({
      kind: "countdown",
      warn: true,
      expired: true,
      remainingMs: 0,
    });
  });

  it("stands the countdown up without a bar when iat is absent", () => {
    const fresh = tokenFreshness(
      `Bearer ${jwt({ exp: (5 * HOUR) / 1000 })}`,
      0,
    );
    expect(fresh.kind).toBe("countdown");
    if (fresh.kind === "countdown") {
      expect(fresh.fraction).toBeUndefined();
    }
  });

  it("is opaque for a token with no readable expiry", () => {
    expect(tokenFreshness("Bearer opaque", 0)).toEqual({ kind: "opaque" });
  });
});
