import { type ComponentChildren, createContext } from "preact";
import { useCallback, useContext, useState } from "preact/hooks";

type Announce = (message: string) => void;

const AnnounceContext = createContext<Announce>(() => {});

/**
 * Hosts the popup's single polite live region (toasts, saves, verify summaries)
 * and hands descendants an `announce` function. A fresh keyed node per call makes
 * assistive tech re-read even an identical message.
 */
export function LiveRegionProvider({
  children,
}: {
  children: ComponentChildren;
}) {
  const [state, setState] = useState({ message: "", nonce: 0 });
  const announce = useCallback<Announce>((message) => {
    setState((prev) => ({ message, nonce: prev.nonce + 1 }));
  }, []);

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        <span key={state.nonce}>{state.message}</span>
      </div>
    </AnnounceContext.Provider>
  );
}

export function useAnnounce(): Announce {
  return useContext(AnnounceContext);
}
