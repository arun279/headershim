import { useEffect, useState } from "preact/hooks";
import type { RegexValidator } from "../../core/codec/modheader";
import type { Profile } from "../../core/model";

/**
 * Which displayed rules carry a regex scope Chrome's engine rejects. Such
 * rules exist only disabled (an import stores them that way and every enable
 * path re-validates), so only disabled regex scopes need checking — enabled
 * ones were proven on their way into the enabled set.
 */
export function useInvalidRules(
  profiles: readonly Profile[],
  validateRegex: RegexValidator,
): ReadonlySet<string> {
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let disposed = false;
    const candidates = profiles.flatMap((profile) =>
      profile.rules.flatMap((rule) =>
        rule.scope.type === "regex" && !rule.enabled
          ? [{ id: rule.id, regex: rule.scope.regex }]
          : [],
      ),
    );
    void Promise.all(
      candidates.map(async ({ id, regex }) =>
        (await validateRegex(regex)).ok ? undefined : id,
      ),
    ).then((ids) => {
      if (disposed) {
        return;
      }
      const next = new Set(ids.filter((id) => id !== undefined));
      // Identity-stable when nothing changed, so consumers don't re-render on
      // every document write.
      setInvalid((prev) =>
        prev.size === next.size && [...next].every((id) => prev.has(id))
          ? prev
          : next,
      );
    });
    return () => {
      disposed = true;
    };
  }, [profiles, validateRegex]);

  return invalid;
}
