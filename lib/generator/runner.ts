import { getServerClient } from "@/lib/ldServer";
import {
  GENERATORS,
  isActive,
  type GeneratorId,
  type GeneratorStatus,
} from "@/lib/generator/catalog";
import { SCENARIOS } from "@/lib/generator/scenarios";

// Runs the demo generators on the server, where a backend's traffic belongs.
// That is also what lets one survive a refresh, a closed tab or a forgotten
// one: the browser only starts and stops them and reads back how they are
// doing. Each deployment runs a single replica, so this process is the only
// one there is to ask.
//
// Kept on globalThis because the dev server reloads modules on every edit,
// and a reloaded module would otherwise forget generators still running.

type Run = {
  status: GeneratorStatus;
  controller: AbortController;
};

const scope = globalThis as typeof globalThis & {
  __togglewearGenerators?: Map<GeneratorId, Run>;
};
const runs = (scope.__togglewearGenerators ??= new Map());

function idle(id: GeneratorId): GeneratorStatus {
  return { id, state: "idle", detail: "", sent: 0 };
}

export function generatorStatuses(): GeneratorStatus[] {
  return GENERATORS.map(({ id }) => runs.get(id)?.status ?? idle(id));
}

export async function startGenerator(id: GeneratorId) {
  const existing = runs.get(id);
  if (existing && isActive(existing.status.state)) return;

  const controller = new AbortController();
  const run: Run = {
    controller,
    status: {
      id,
      state: "running",
      detail: "Starting.",
      sent: 0,
      startedAt: Date.now(),
    },
  };
  runs.set(id, run);

  // Ignored once stopped, so a loop finishing its last iteration cannot
  // overwrite the stop with a stale update.
  const update = (patch: Partial<GeneratorStatus>) => {
    if (!controller.signal.aborted) run.status = { ...run.status, ...patch };
  };
  const end = (state: GeneratorStatus["state"], detail: string) =>
    update({ state, detail, endedAt: Date.now() });

  const client = await getServerClient();
  if (!client) {
    end("error", "LaunchDarkly is not connected. Check LD_SDK_KEY on the server.");
    return;
  }

  SCENARIOS[id]({ client, signal: controller.signal, update })
    .then((detail) => end("done", detail))
    .catch((error) => {
      if (controller.signal.aborted) return;
      console.error(`Demo generator ${id} failed`, error);
      end("error", "Something went wrong. The server log has the details.");
    })
    .finally(() => {
      client.flush().catch(() => {
        // The SDK retries on its next interval.
      });
    });
}

export function stopGenerator(id: GeneratorId) {
  const run = runs.get(id);
  if (!run || !isActive(run.status.state)) return;
  run.status = {
    ...run.status,
    state: "stopped",
    detail: "Stopped by hand.",
    endedAt: Date.now(),
  };
  run.controller.abort();
}
