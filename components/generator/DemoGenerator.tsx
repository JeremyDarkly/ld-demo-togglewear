import { useCallback, useEffect, useState } from "react";

import GeneratorPanel from "@/components/generator/GeneratorPanel";

// Cmd+K, or Ctrl+K off a Mac, opens the demo generator from any page, and so
// does the Demo tools tab of Under the hood, for whoever doesn't know the
// shortcut. Nothing else on the store's own pages opens it: a prospect
// watching the demo should see the store and not its controls.
export const OPEN_GENERATOR_EVENT = "togglewear:open-generator";

export function openDemoGenerator() {
  window.dispatchEvent(new Event(OPEN_GENERATOR_EVENT));
}

export default function DemoGenerator() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((was) => !was);
      }
    }
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_GENERATOR_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_GENERATOR_EVENT, onOpen);
    };
  }, []);

  return open ? <GeneratorPanel onClose={close} /> : null;
}
