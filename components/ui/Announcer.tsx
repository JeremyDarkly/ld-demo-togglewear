import { useEffect, useState } from "react";

// One hidden live region for the whole store, so a change that happens out of
// sight (the cart count in the header, say) is still read out by a screen
// reader. Mounted once in _app; announce() is a no-op before then.
let speak: ((message: string) => void) | null = null;

export function announce(message: string) {
  speak?.(message);
}

export function Announcer() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    let frame = 0;
    speak = (next) => {
      // Cleared first so the same message twice in a row (adding a second
      // hoodie) is read again rather than seen as no change.
      setMessage("");
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setMessage(next));
    };
    return () => {
      cancelAnimationFrame(frame);
      speak = null;
    };
  }, []);

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}
