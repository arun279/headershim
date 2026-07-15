import { useRef, useState } from "preact/hooks";

/** Draft state with synchronous refs for event handlers that share one gesture. */
export function useDraftState<D>(initial: () => D, clearErrors: () => void) {
  const [draft, setDraft] = useState(initial);
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);

  const update = (transform: (draft: D) => D) => {
    dirtyRef.current = true;
    draftRef.current = transform(draftRef.current);
    setDraft(draftRef.current);
    clearErrors();
  };

  return { draft, draftRef, dirtyRef, busyRef, update };
}
