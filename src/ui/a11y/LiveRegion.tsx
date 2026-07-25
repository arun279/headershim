import { type ComponentChildren, createContext } from "preact";
import {
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";

interface LiveRegion {
  /** Speak a message and return the nonce that identifies this announcement. */
  announce: (message: string, options?: { assertive?: boolean }) => number;
  /** Clear the polite region, but only if `nonce` is still its latest message,
      so retiring a spent toast never talks over a newer announcement. */
  retract: (nonce: number) => void;
}

const LiveRegionContext = createContext<LiveRegion>({
  announce: () => 0,
  retract: () => {},
});

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
  const announce = useCallback<LiveRegion["announce"]>((message, options) => {
    const assertiveAnnouncement = options?.assertive === true;
    const nonceRef = assertiveAnnouncement ? assertiveNonce : politeNonce;
    nonceRef.current += 1;
    const nonce = nonceRef.current;
    const setter = assertiveAnnouncement ? setAssertive : setPolite;
    setter({ message, nonce });
    return nonce;
  }, []);
  const retract = useCallback<LiveRegion["retract"]>(
    (nonce) => {
      if (politeNonce.current === nonce) {
        announce("");
      }
    },
    [announce],
  );
  const region = useMemo(() => ({ announce, retract }), [announce, retract]);

  return (
    <LiveRegionContext.Provider value={region}>
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
    </LiveRegionContext.Provider>
  );
}

export function useAnnounce(): LiveRegion["announce"] {
  return useContext(LiveRegionContext).announce;
}

export function useLiveRegion(): LiveRegion {
  return useContext(LiveRegionContext);
}
