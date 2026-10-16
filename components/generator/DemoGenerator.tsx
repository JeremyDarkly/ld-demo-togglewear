import { useCallback, useEffect, useState } from "react";

import GeneratorPanel from "@/components/generator/GeneratorPanel";

// Cmd+K, or Ctrl+K off a Mac, opens the demo generator from any page. There
// is deliberately nothing on screen to click instead: a prospect watching
// the demo should see the store and not its controls.
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
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return open ? <GeneratorPanel onClose={close} /> : null;
}
