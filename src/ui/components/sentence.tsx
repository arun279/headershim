import type { ComponentChildren } from "preact";
import type { Sentence } from "../copy";

/** Hostnames and counts render in the data face; the words stay UI face. */
export function sentence(parts: Sentence): ComponentChildren {
  return parts.map((part) =>
    typeof part === "string" ? part : <span class="mono">{part.data}</span>,
  );
}
