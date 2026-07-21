import { type ComponentChildren, createContext } from "preact";
import { useCallback, useContext, useRef, useState } from "preact/hooks";

type Announce = (message: string, options?: { assertive?: boolean }) => number;

const AnnounceContext = createContext<Announce>(() => 0);

/**
 * Hosts the popup's two persistent live regions — polite (toasts, saves, verify
 * summaries) and assertive (a can't-run caution on the popup's first open, which
 * a role swap on an already-mounted node cannot announce) — and hands descendants
 * an `announce` function. A fresh keyed node per call makes assistive tech re-read
 * even an identical message.
 */
export function LiveRegionProvider({
  children,
}: {
  children: ComponentChildren;
}) {
  const [polite, setPolite] = useState({ message: "", nonce: 0 });
  const [assertive, setAssertive] = useState({ message: "", nonce: 0 });
  const politeNonce = useRef(0);
  const assertiveNonce = useRef(0);
  const announce = useCallback<Announce>((message, options) => {
    const assertiveAnnouncement = options?.assertive === true;
    const nonceRef = assertiveAnnouncement ? assertiveNonce : politeNonce;
    nonceRef.current += 1;
    const nonce = nonceRef.current;
    const setter = assertiveAnnouncement ? setAssertive : setPolite;
    setter({ message, nonce });
    return nonce;
  }, []);

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        <span key={polite.nonce}>{polite.message}</span>
      </div>
      <div
        class="sr-only"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        <span key={assertive.nonce}>{assertive.message}</span>
      </div>
    </AnnounceContext.Provider>
  );
}

export function useAnnounce(): Announce {
  return useContext(AnnounceContext);
}
