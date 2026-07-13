import { useRef, useState } from "preact/hooks";

/**
 * The inline commit model shared by the rule editor and the This-tab composer
 * (no save ceremony). Enter or focus-leave commits when the fields
 * hold up, Ctrl/Cmd+Enter commits and asks for a grant in the same gesture, Esc
 * reverts, and single-letter popup shortcuts never fire from the editor's own
 * buttons. The hook owns the draft, the interaction refs, and the fieldset key
 * and focus handlers; each editor supplies its own `commit` and error handling.
 */
interface InlineCommitOptions {
  /** Commits the draft; `grantImmediately` is true only for Ctrl/Cmd+Enter. */
  commit: (grantImmediately: boolean) => void;
  onClose: () => void;
  /** Clears the current field errors on any edit. */
  clearErrors: () => void;
  /** Focus leaving while this returns true abandons instead of committing. */
  abandon?: () => boolean;
}

export function useInlineCommit<D>(
  initial: () => D,
  options: InlineCommitOptions,
) {
  const [draft, setDraft] = useState(initial);
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);
  const rootRef = useRef<HTMLFieldSetElement | null>(null);

  const update = (transform: (draft: D) => D) => {
    dirtyRef.current = true;
    draftRef.current = transform(draftRef.current);
    setDraft(draftRef.current);
    options.clearErrors();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      // A commit in flight can't be unwound by closing; Esc waits it out.
      if (!busyRef.current) {
        options.onClose();
      }
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (event.key === "Enter") {
      // Enter on a button activates it; everywhere else it commits.
      if (target?.tagName !== "BUTTON") {
        event.preventDefault();
        options.commit(event.metaKey || event.ctrlKey);
      }
      return;
    }
    // The open editor owns its keys: single-letter popup commands must not
    // fire from its buttons (segments, disclosure, chips, Insert).
    if (target?.tagName === "BUTTON" && /^[a-zA-Z0-9]$/.test(event.key)) {
      event.preventDefault();
    }
  };

  const onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || rootRef.current?.contains(next) === true) {
      return;
    }
    if (options.abandon?.() === true) {
      options.onClose();
    } else if (dirtyRef.current) {
      options.commit(false);
    } else {
      options.onClose();
    }
  };

  return {
    draft,
    draftRef,
    dirtyRef,
    busyRef,
    rootRef,
    update,
    onKeyDown,
    onFocusOut,
  };
}
