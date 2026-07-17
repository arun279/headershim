/**
 * Client-side token reading for the popup's credential hero. Everything here is
 * a pure read of the token's own bytes: it never asks the engine to touch the
 * wire, invent a baseline, or print an expiry it cannot know. A countdown is
 * drawn only where a countdown can be true (a JWT that carries its own `exp`);
 * an opaque token reports only that it has no expiry to read.
 */

const SCHEME = /^(basic|bearer|digest|negotiate)\s+/i;

export interface MaskedToken {
  /** The auth scheme word shown in muted ink, when the value carries one. */
  readonly scheme?: string;
  /** The last four credential characters, the one part shown in the clear. */
  readonly last4: string;
  /** False when the credential is too short to reveal even a tail safely. */
  readonly hasTail: boolean;
}

/**
 * Splits a credential into the scheme word, a fixed run of dots (never the real
 * length), and its last four characters. The tail is the only cleartext; a
 * shoulder-surfer sees nothing that identifies the secret.
 */
export function maskToken(value: string): MaskedToken {
  const scheme = SCHEME.exec(value)?.[1];
  const credential =
    scheme === undefined ? value : value.slice(scheme.length).trimStart();
  const tail = credential.slice(-4);
  return {
    ...(scheme === undefined ? {} : { scheme }),
    last4: tail,
    hasTail: credential.length > 4,
  };
}

export interface JwtClaims {
  readonly expMs: number;
  readonly iatMs?: number;
}

/**
 * Decodes a Bearer JWT's `exp` (and `iat`, when present) from its payload
 * segment. Returns undefined for anything that is not a three-segment token
 * with a numeric `exp` — that absence is what turns the hero opaque.
 */
export function decodeJwtExp(value: string): JwtClaims | undefined {
  const scheme = SCHEME.exec(value)?.[1];
  const token =
    scheme === undefined ? value : value.slice(scheme.length).trimStart();
  const parts = token.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  const payload = decodeSegment(parts[1] ?? "");
  if (payload === undefined) {
    return undefined;
  }
  const exp = payload.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    return undefined;
  }
  const iat = payload.iat;
  return {
    expMs: exp * 1000,
    ...(typeof iat === "number" && Number.isFinite(iat)
      ? { iatMs: iat * 1000 }
      : {}),
  };
}

interface JwtPayload {
  readonly exp?: unknown;
  readonly iat?: unknown;
}

function decodeSegment(segment: string): JwtPayload | undefined {
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as JwtPayload)
      : undefined;
  } catch {
    // A token is untrusted input; a malformed payload is simply not a JWT.
    return undefined;
  }
}

export type Freshness =
  | {
      readonly kind: "countdown";
      readonly remainingMs: number;
      /** exp - iat fill, present only when the token also carries `iat`. */
      readonly fraction?: number;
      readonly warn: boolean;
      readonly expired: boolean;
    }
  | { readonly kind: "opaque" };

/** The share of a JWT's life left, below which the countdown turns amber. */
const WARN_FRACTION = 0.15;
/** The absolute window for countdowns that have no issued-at time. */
const WARN_MS = 15 * 60 * 1000;

export function tokenFreshness(value: string, now: number): Freshness {
  const claims = decodeJwtExp(value);
  if (claims === undefined) {
    return { kind: "opaque" };
  }
  const remainingMs = claims.expMs - now;
  const expired = remainingMs <= 0;
  const fraction =
    claims.iatMs !== undefined && claims.expMs > claims.iatMs
      ? Math.min(1, Math.max(0, remainingMs / (claims.expMs - claims.iatMs)))
      : undefined;
  const warn =
    expired ||
    (fraction === undefined
      ? remainingMs <= WARN_MS
      : fraction <= WARN_FRACTION);
  return {
    kind: "countdown",
    remainingMs: Math.max(0, remainingMs),
    ...(fraction === undefined ? {} : { fraction }),
    warn,
    expired,
  };
}
