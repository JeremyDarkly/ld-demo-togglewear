import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Activity, ActivityGroup, ActivityKind } from "@/lib/activity";

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

// The moments worth catching while talking: LaunchDarkly pushing a change,
// and something going wrong.
const ACCENTS: Partial<Record<ActivityKind, string>> = {
  change: "before:bg-base-lime",
  error: "before:bg-[#FF6B6B]",
};

// Past this a detail is clamped to two lines and opens on a click: a judge's
// full explanation is worth reading, but not every time it scrolls past.
const LONG_DETAIL = 110;

type Item =
  | { type: "line"; entry: Activity }
  | { type: "group"; group: ActivityGroup; entries: Activity[] };

// One AI request's lines (lib/activity.ts activityGroup) become one item,
// where its first line arrived; everything else stays a line of its own.
function toItems(entries: Activity[]): Item[] {
  const items: Item[] = [];
  const groups = new Map<number, Extract<Item, { type: "group" }>>();
  for (const entry of entries) {
    if (!entry.group) {
      items.push({ type: "line", entry });
      continue;
    }
    let item = groups.get(entry.group.id);
    if (!item) {
      item = { type: "group", group: entry.group, entries: [] };
      groups.set(entry.group.id, item);
      items.push(item);
    }
    item.entries.push(entry);
  }
  return items;
}

// A request in one line: who it was for, the model or models, how long the
// answer took, the tokens it cost and what the judges gave it.
function summarize(group: ActivityGroup, entries: Activity[]) {
  const who = entries.find((e) => e.who)?.who;
  const failure = entries.find((e) => e.kind === "error");
  const calls = entries.filter((e) => e.stats?.model);
  const models = [...new Set(calls.map((e) => e.stats!.model!))];
  const tokensIn = calls.reduce((sum, e) => sum + (e.stats!.inputTokens ?? 0), 0);
  const tokensOut = calls.reduce((sum, e) => sum + (e.stats!.outputTokens ?? 0), 0);
  const answeredAt = calls.length ? calls[calls.length - 1].at : undefined;
  const scores = entries
    .filter((e) => e.kind === "judge" && e.stats?.score !== undefined)
    .map((e) => `${e.stats!.judge} ${e.stats!.score}`);

  const detail = failure
    ? failure.title
    : [
        models.join(", "),
        answeredAt !== undefined && `${((answeredAt - group.startedAt) / 1000).toFixed(1)}s`,
        tokensIn + tokensOut > 0 && `${tokensIn.toLocaleString()} in / ${tokensOut.toLocaleString()} out tokens`,
        ...scores,
      ]
        .filter(Boolean)
        .join(" · ") || "working…";

  return { title: who ? `${group.label} for ${who}` : group.label, detail, failed: Boolean(failure) };
}

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

  // A request shows under a filter if any of its steps would, and then with
  // all of them, so its story stays whole.
  const kinds = FILTERS.find((f) => f.id === filter)?.kinds;
  const shown = toItems(entries).filter(
    (item) =>
      !kinds ||
      (item.type === "line" ? kinds.includes(item.entry.kind) : item.entries.some((e) => kinds.includes(e.kind))),
  );

  // Which requests and long lines are open, by "g" or "l" and their id.
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpened((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });

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
            shown.map((item) =>
              item.type === "line" ? (
                <Line
                  key={`l${item.entry.id}`}
                  entry={item.entry}
                  open={opened.has(`l${item.entry.id}`)}
                  onToggle={() => toggle(`l${item.entry.id}`)}
                />
              ) : (
                <Group
                  key={`g${item.group.id}`}
                  group={item.group}
                  entries={item.entries}
                  open={opened.has(`g${item.group.id}`)}
                  onToggle={() => toggle(`g${item.group.id}`)}
                  opened={opened}
                  onToggleLine={toggle}
                />
              ),
            )
          )}
        </div>
      </div>
    </div>
  );
}

// The left bar ACCENTS colours, drawn outside the row so text stays aligned.
const ROW = "relative flex w-full gap-3 py-1 text-left before:absolute before:-left-2.5 before:bottom-1.5 before:top-1.5 before:w-0.5 before:rounded-full";

function Line({ entry, open, onToggle }: { entry: Activity; open: boolean; onToggle: () => void }) {
  const tag = TAGS[entry.kind];
  const long = (entry.detail?.length ?? 0) > LONG_DETAIL;
  const body = (
    <>
      <span className="shrink-0 text-grays-05">{time(entry.at)}</span>
      <span className={`w-[52px] shrink-0 ${tag.className}`}>{tag.label}</span>
      <span className="min-w-0 flex-1">
        <span className="break-words text-grays-01">
          {entry.title}
          {entry.count > 1 && <span className="text-grays-03"> ×{entry.count}</span>}
        </span>
        {entry.detail && (
          <span className={`block break-words text-grays-03 ${long && !open ? "line-clamp-2" : ""}`}>
            {entry.detail}
          </span>
        )}
      </span>
    </>
  );
  const className = `${ROW} ${ACCENTS[entry.kind] ?? ""}`;

  return long ? (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={`${className} rounded-[6px] hover:bg-grays-black-01 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-grays-05`}
    >
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

function Group({
  group,
  entries,
  open,
  onToggle,
  opened,
  onToggleLine,
}: {
  group: ActivityGroup;
  entries: Activity[];
  open: boolean;
  onToggle: () => void;
  opened: Set<string>;
  onToggleLine: (key: string) => void;
}) {
  const { title, detail, failed } = summarize(group, entries);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`${ROW} rounded-[6px] hover:bg-grays-black-01 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-grays-05 ${
          failed ? ACCENTS.error : ""
        }`}
      >
        <span className="shrink-0 text-grays-05">{time(entries[0].at)}</span>
        <span className={`w-[52px] shrink-0 ${failed ? "text-[#FF6B6B]" : "text-[#9AA8FF]"}`}>
          {failed ? "ERROR" : "AI"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="break-words text-grays-01">
            <span aria-hidden="true" className="mr-1.5 inline-block w-2 text-grays-03">
              {open ? "▾" : "▸"}
            </span>
            {title}
            <span className="text-grays-04">
              {" "}
              · {entries.length} {entries.length === 1 ? "step" : "steps"}
            </span>
          </span>
          <span className="block break-words pl-[18px] text-grays-03">{detail}</span>
        </span>
      </button>
      {open && (
        <div className="mb-1 ml-1 border-l border-grays-06 pl-3">
          {entries.map((entry) => (
            <Line
              key={entry.id}
              entry={entry}
              open={opened.has(`l${entry.id}`)}
              onToggle={() => onToggleLine(`l${entry.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
