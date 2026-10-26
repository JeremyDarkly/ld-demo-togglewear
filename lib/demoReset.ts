import { GENERATORS } from "@/lib/generator/catalog";
import { stopGenerator } from "@/lib/generator/runner";

// Puts the flags and the AgentControl config a demo changes back to how
// DemoBuilder leaves them, for the Reset demo button in Under the hood.
//
// The only part of the store that changes LaunchDarkly rather than reading
// it, so it has its own key: LD_RESET_TOKEN, a service token DemoBuilder
// makes for each environment with an inline policy allowing exactly these
// changes in this project's production environment and nothing else. The
// Delete and Rebuild workflows remove it. Keep RESETS, DemoBuilder's policy
// and the README's "Resetting after a demo" table in step.
//
// Each change goes through LaunchDarkly's REST API as a semantic patch with
// a comment, so the audit log says the store's reset made it. Something
// already in its resting state is left alone rather than rewritten.

const API = "https://app.launchdarkly.com/api/v2";
const ENVIRONMENT = "production";
const COMMENT = "Reset demo, from Under the hood in the store";

export type ResetResult = { what: string; outcome: "reset" | "unchanged" | "failed"; detail?: string };

type Flag = {
  variations: { _id: string; value: unknown }[];
  environments: Record<string, { on: boolean; fallthrough: { variation?: number } }>;
};

type ConfigTargeting = {
  variations: { _id: string; name: string }[];
  environments: Record<string, { fallthrough: { variation?: number } }>;
};

type Reset =
  | { what: string; flag: string; on: boolean; serve?: unknown }
  | { what: string; config: string; serve: string };

// serve is a flag variation's value, or a config variation's name.
const RESETS: Reset[] = [
  { what: "05 Catalog API v2", flag: "catalogApiV2", on: false },
  { what: "12 New Payment Processor", flag: "newPaymentProcessor", on: true },
  { what: "13 Card Testing Protection", flag: "cardTestingProtection", on: false },
  { what: "14 Recommendation Engine", flag: "recommendationEngine", on: true, serve: "personalized" },
  { what: "Smart Search", config: "smart-search", serve: "Llama 4 Maverick" },
];

export function resetConfigured() {
  return Boolean(process.env.LD_RESET_TOKEN && process.env.LD_PROJECT_KEY);
}

async function ld<T>(path: string, init: RequestInit & { version?: string } = {}): Promise<T> {
  const { version = "20240415", headers, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: { Authorization: process.env.LD_RESET_TOKEN ?? "", "LD-API-Version": version, ...headers },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `LaunchDarkly answered ${res.status}`);
  }
  return (await res.json()) as T;
}

async function resetFlag(project: string, reset: Extract<Reset, { flag: string }>) {
  const flag = await ld<Flag>(`/flags/${project}/${reset.flag}?env=${ENVIRONMENT}`);
  const env = flag.environments[ENVIRONMENT];
  const instructions: object[] = [];

  if (env.on !== reset.on) instructions.push({ kind: reset.on ? "turnFlagOn" : "turnFlagOff" });
  if (reset.serve !== undefined) {
    const index = flag.variations.findIndex((v) => v.value === reset.serve);
    if (index < 0) throw new Error(`No ${String(reset.serve)} variation`);
    if (env.fallthrough.variation !== index) {
      instructions.push({ kind: "updateFallthroughVariationOrRollout", variationId: flag.variations[index]._id });
    }
  }
  if (!instructions.length) return false;

  await ld(`/flags/${project}/${reset.flag}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json; domain-model=launchdarkly.semanticpatch" },
    body: JSON.stringify({ environmentKey: ENVIRONMENT, comment: COMMENT, instructions }),
  });
  return true;
}

async function resetConfig(project: string, reset: Extract<Reset, { config: string }>) {
  const path = `/projects/${project}/ai-configs/${reset.config}/targeting`;
  // AgentControl targeting is only in the beta API.
  const targeting = await ld<ConfigTargeting>(path, { version: "beta" });
  const index = targeting.variations.findIndex((v) => v.name === reset.serve);
  if (index < 0) throw new Error(`No ${reset.serve} variation`);
  if (targeting.environments[ENVIRONMENT]?.fallthrough.variation === index) return false;

  await ld(path, {
    method: "PATCH",
    version: "beta",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      environmentKey: ENVIRONMENT,
      comment: COMMENT,
      instructions: [{ kind: "updateFallthroughVariationOrRollout", variationId: targeting.variations[index]._id }],
    }),
  });
  return true;
}

export async function resetDemo(): Promise<ResetResult[]> {
  const project = process.env.LD_PROJECT_KEY ?? "";

  // First, or a generator still running sets its trigger off again: the card
  // testing one would turn flag 13 back on a couple of minutes later.
  GENERATORS.forEach(({ id }) => stopGenerator(id));

  return Promise.all(
    RESETS.map(async (reset): Promise<ResetResult> => {
      try {
        const changed = "flag" in reset ? await resetFlag(project, reset) : await resetConfig(project, reset);
        return { what: reset.what, outcome: changed ? "reset" : "unchanged" };
      } catch (err) {
        return { what: reset.what, outcome: "failed", detail: (err as Error).message.slice(0, 200) };
      }
    }),
  );
}
