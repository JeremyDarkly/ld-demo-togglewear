import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Activity, ActivityKind } from "@/lib/activity";

// What the store's backend is doing with LaunchDarkly, as it happens
// (lib/activity.ts and pages/api/activity.ts). Kept to the server on
// purpose: the browser's own evaluations and events are what the developer
// toolbar shows.

const KEEP = 300;

const FILTERS: { id: string; label: string; kinds: ActivityKind[] | null }[] = [
  { id: "all", label: "All", kinds: null },
  { id: "flags", label: "Flags", kinds: ["flag", "config", "change"] },
  { id: "ai", label: "AI", kinds: ["model", "tool", "judge", "config"] },
  { id: "problems", label: "Errors", kinds: ["error", "warning"] },
  { id: "generator", label: "Generator", kinds: ["generator"] },
];

const TAGS: Record<ActivityKind, { label: string; className: string }> = {
  flag: { label: "FLAG", className: "text-base-cyan" },
  config: { label: "CONFIG", className: "text-accent-purple" },
  change: { label: "CHANGE", className: "text-base-lime" },
  model: { label: "MODEL", className: "text-[#9AA8FF]" },
  tool: { label: "TOOL", className: "text-[#9AA8FF]" },
  judge: { label: "JUDGE", className: "text-[#9AA8FF]" },
  error: { label: "ERROR", className: "text-[#FF6B6B]" },
  warning: { label: "WARN", className: "text-base-orange" },
  generator: { label: "GEN", className: "text-grays-03" },
};

// Survives switching tabs, which unmounts this one: the stream replays what
// the server still holds, and anything at or before this was cleared.
let clearedThrough = 0;

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function LiveTab() {
  const [entries, setEntries] = useState<Activity[]>([]);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState("all");
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const source = new EventSource("/api/activity");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (message) => {
      if (pausedRef.current) return;
      let entry: Activity;
      try {
        entry = JSON.parse(message.data);
      } catch {
        return;
      }
      if (entry.id <= clearedThrough) return;
      setEntries((was) => {
        const at = was.findIndex((e) => e.id === entry.id);
        if (at >= 0) {
          const next = was.slice();
          next[at] = entry;
          return next;
        }
        const next = [...was, entry];
        return next.length > KEEP ? next.slice(next.length - KEEP) : next;
      });
    };
    return () => source.close();
  }, []);

  const kinds = FILTERS.find((f) => f.id === filter)?.kinds;
  const shown = kinds ? entries.filter((e) => kinds.includes(e.kind)) : entries;

  // Follows the newest line unless someone has scrolled up to read.
  useLayoutEffect(() => {
    if (pinned.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [shown.length, entries]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-3 px-6 py-4">
        <p className="font-sohne text-small text-grays-04">
          What the store&apos;s server is doing with LaunchDarkly right now: every flag and AI
          Config it evaluates and why, changes LaunchDarkly streams to it, model calls and
          errors. Flip a flag or use the store and watch it arrive.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-full px-3 py-1 font-sohne text-xsmall font-medium transition-colors ${
                  filter === f.id
                    ? "bg-grays-ld-black text-grays-white"
                    : "border border-grays-02 text-grays-ld-black hover:bg-base-lime"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-pressed={paused}
              onClick={() => setPaused((p) => !p)}
              className="rounded-full border border-grays-02 px-3 py-1 font-sohne text-xsmall font-medium text-grays-ld-black transition-colors hover:bg-base-lime"
            >
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={() => {
                clearedThrough = entries.reduce((max, e) => Math.max(max, e.id), clearedThrough);
                setEntries([]);
              }}
              className="rounded-full border border-grays-02 px-3 py-1 font-sohne text-xsmall font-medium text-grays-ld-black transition-colors hover:bg-base-lime"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="mx-6 mb-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] bg-grays-ld-black">
        <div className="flex shrink-0 items-center gap-2 border-b border-grays-06 px-4 py-2.5">
          <span
            className={`size-2 rounded-full ${connected ? "bg-base-lime" : "bg-grays-05"}`}
            aria-hidden="true"
          />
          <span className="font-sohne-mono text-xsmall-mono text-grays-03">
            togglewear-api {connected ? (paused ? "· paused" : "· live") : "· connecting"}
          </span>
        </div>
        <div
          ref={list}
          onScroll={(event) => {
            const el = event.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-sohne-mono text-xsmall-mono leading-relaxed"
          aria-live="polite"
        >
          {shown.length === 0 ? (
            <p className="text-grays-04">
              {connected
                ? "Waiting for the server. Open a product page, ask the swag assistant something or change a flag."
                : "Connecting to the store's server."}
            </p>
          ) : (
            shown.map((entry) => {
              const tag = TAGS[entry.kind];
              return (
                <div key={entry.id} className="flex gap-3 py-1">
                  <span className="shrink-0 text-grays-05">{time(entry.at)}</span>
                  <span className={`w-[52px] shrink-0 ${tag.className}`}>{tag.label}</span>
                  <span className="min-w-0 flex-1">
                    <span className="break-words text-grays-01">
                      {entry.title}
                      {entry.count > 1 && <span className="text-grays-03"> ×{entry.count}</span>}
                    </span>
                    {entry.detail && (
                      <span className="block break-words text-grays-03">{entry.detail}</span>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
