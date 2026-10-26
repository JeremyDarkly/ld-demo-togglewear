import { AsyncLocalStorage } from "node:async_hooks";
import type { integrations, LDContext, LDEvaluationDetail } from "@launchdarkly/node-server-sdk";
import type { NextApiHandler } from "next";

// What the server has just done with LaunchDarkly, for the Live tab of Under
// the hood: every flag and AI Config it evaluated and why, each change
// LaunchDarkly streamed to it, each model and tool call an agent made, the
// judges' scores, the errors the routes reported and what the demo
// generator is up to. ToggleBank's Backend Terminal streams raw console
// output; these are written to be read aloud on a call.
//
// One deployment runs one replica (lib/generator/runner.ts), so the feed in
// this process is the whole of the store's backend. Kept on globalThis so a
// dev server's hot reload doesn't empty it or strand open tabs.

export type ActivityKind =
  | "flag"
  | "config"
  | "change"
  | "model"
  | "tool"
  | "judge"
  | "error"
  | "warning"
  | "generator";

export type Activity = {
  id: number;
  at: number;
  kind: ActivityKind;
  title: string;
  detail?: string;
  // How many times the same thing happened in a row, a second or two apart:
  // a category page asks for every card's stock at once.
  count: number;
  // Set on everything recorded while one AI request ran (activityGroup), so
  // the Live tab can show the request as one line that opens to its steps.
  group?: ActivityGroup;
  // Who a flag or config was evaluated for, for that line's title.
  who?: string;
  // What the Live tab adds up for a group's line.
  stats?: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    judge?: string;
    score?: number;
  };
};

export type ActivityGroup = { id: number; label: string; startedAt: number };

type Listener = (entry: Activity) => void;

const KEEP = 200;
const MERGE_WITHIN_MS = 3_000;

const scope = globalThis as typeof globalThis & {
  __togglewearActivity?: {
    entries: Activity[];
    listeners: Set<Listener>;
    nextId: number;
    nextGroup: number;
  };
};
const feed = (scope.__togglewearActivity ??= {
  entries: [],
  listeners: new Set(),
  nextId: 1,
  nextGroup: 1,
});
// A hot reload keeps the feed from before this field existed.
feed.nextGroup ??= 1;

// The request an entry belongs to. AsyncLocalStorage follows the request's
// promises, so the judges' scores, which arrive after the response has been
// sent, still land in the request that asked for them.
const groupScope = new AsyncLocalStorage<ActivityGroup>();

// Wraps an AI route's handler so everything it records is one group in the
// Live tab, named label (the agent, as the store calls it).
export function activityGroup(label: string, handler: NextApiHandler): NextApiHandler {
  return (req, res) =>
    groupScope.run({ id: feed.nextGroup++, label, startedAt: Date.now() }, () => handler(req, res));
}

// Runs fn outside any request's group. Work it starts that outlives the
// request, like the SDK's streaming connection, would otherwise record into
// whichever request happened to start it.
export function outsideGroup<T>(fn: () => T): T {
  return groupScope.exit(fn);
}

export function recentActivity(): Activity[] {
  return feed.entries;
}

export function onActivity(listener: Listener) {
  feed.listeners.add(listener);
  return () => {
    feed.listeners.delete(listener);
  };
}

export function recordActivity(entry: Omit<Activity, "id" | "at" | "count" | "group">) {
  const now = Date.now();
  const group = groupScope.getStore();
  const last = feed.entries[feed.entries.length - 1];
  if (
    last &&
    now - last.at < MERGE_WITHIN_MS &&
    last.kind === entry.kind &&
    last.title === entry.title &&
    last.detail === entry.detail &&
    last.group?.id === group?.id
  ) {
    last.count += 1;
    last.at = now;
    feed.listeners.forEach((listener) => listener(last));
    return;
  }

  const added: Activity = { ...entry, id: feed.nextId++, at: now, count: 1, ...(group && { group }) };
  feed.entries.push(added);
  if (feed.entries.length > KEEP) feed.entries.splice(0, feed.entries.length - KEEP);
  feed.listeners.forEach((listener) => listener(added));
}

// The demo generator evaluates flags thousands of times a minute for
// visitors who don't exist. Its work runs inside this, so the hook below can
// leave it out and the generator reports its progress in its own words.
const generatorWork = new AsyncLocalStorage<true>();

export function asGenerator<T>(work: () => Promise<T>): Promise<T> {
  return generatorWork.run(true, work);
}

export function fromGenerator() {
  return generatorWork.getStore() === true;
}

// Who a context is, the way the shopper switcher names them.
export function describeContext(context: LDContext) {
  const ctx = context as { kind?: string; key?: string; name?: unknown; anonymous?: boolean };
  if (typeof ctx.name === "string") return ctx.name;
  if (ctx.anonymous) return "a guest";
  return ctx.key ?? "someone";
}

// The reason LaunchDarkly gives with every evaluation, in the words its own
// flag targeting page uses.
function describeReason(detail: LDEvaluationDetail) {
  const reason = detail.reason;
  switch (reason?.kind) {
    case "OFF":
      return "flag is off";
    case "FALLTHROUGH":
      return reason.inExperiment ? "default rule, in an experiment" : "default rule";
    case "TARGET_MATCH":
      return "individually targeted";
    case "RULE_MATCH":
      return `matched rule ${(reason.ruleIndex ?? 0) + 1}${reason.inExperiment ? ", in an experiment" : ""}`;
    case "PREREQUISITE_FAILED":
      return `prerequisite ${reason.prerequisiteKey} not met`;
    case "ERROR":
      return `error: ${reason.errorKind ?? "unknown"}, served the fallback`;
    default:
      return undefined;
  }
}

function describeValue(value: unknown) {
  if (typeof value === "string") return `"${value}"`;
  if (value === null || value === undefined) return "nothing";
  if (typeof value === "object") return JSON.stringify(value).slice(0, 60);
  return String(value);
}

// Registered with the server SDK in lib/ldServer.ts. An AI Config is
// evaluated through the same client as a flag, by its key, and its value
// says which variation was served in _ldMeta.
export const activityHook: integrations.Hook = {
  getMetadata: () => ({ name: "togglewear-live-activity" }),
  afterEvaluation(hookContext, data, detail) {
    if (fromGenerator()) return data;
    const who = describeContext(hookContext.context);
    const why = describeReason(detail);
    const meta = (detail.value as { _ldMeta?: { variationKey?: string; enabled?: boolean } } | null)
      ?._ldMeta;

    if (meta) {
      recordActivity({
        kind: "config",
        title: `${hookContext.flagKey} served ${meta.variationKey ?? "its fallback"} to ${who}`,
        detail: why,
        who,
      });
    } else {
      recordActivity({
        kind: "flag",
        title: `${hookContext.flagKey} evaluated to ${describeValue(detail.value)} for ${who}`,
        detail: why,
        who,
      });
    }
    return data;
  },
};
