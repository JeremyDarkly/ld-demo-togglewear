import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

// Rises and fades in the first time it scrolls into view, and never again.
// The motion itself lives in globals.css beside the page transition, keyed off
// data-reveal, so this only decides when.
//
// Anything already on screen when the page mounts is left alone. Hiding it
// would mean it rendered, vanished on hydration and came back, which is a
// flicker rather than an entrance — and the page transition is already moving
// it. It also means the content is only ever hidden once script is running,
// so a page that fails to hydrate still shows everything.
//
// delay staggers siblings, such as the cards in a grid, so they arrive one
// after another rather than as a single block.
export default function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (element.getBoundingClientRect().top < window.innerHeight) return;

    element.dataset.reveal = "waiting";

    // The bottom margin holds the entrance until the element is a little way
    // up the screen, so it is seen arriving rather than finishing off-screen.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        element.dataset.reveal = "shown";
        observer.disconnect();
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}
