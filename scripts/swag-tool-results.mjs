// Regenerates the tool results recorded in the Swag Assistant's dataset by
// replaying each row's calls against the store's real tools, as the row's
// shopper (metadata.shopper; "guest" is the guest). Rows whose results have
// changed are rewritten in place; --check changes nothing and exits non-zero
// listing them. No LaunchDarkly or AWS credentials needed:
//
//   node --no-warnings --import ./scripts/tool-call-errors-register.mjs scripts/swag-tool-results.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";

import { callSwagTool } from "./swag-tools.mjs";

const DATASET = new URL(
  "../.github/workflows/demo_provisioning_scripts/datasets/swag_assistant.jsonl",
  import.meta.url,
);
const NO_TOOLS = "(no tools were called)";
const check = process.argv.includes("--check");

// One "tool: <name>(<json args>) -> <json result>" line as its call.
function parseCall(line, row) {
  const match = /^tool: ([\w-]+)\((.*?)\) -> /.exec(line);
  if (!match) throw new Error(`row ${row}: cannot read tool call: ${line.slice(0, 80)}`);
  return { name: match[1], args: JSON.parse(match[2]) };
}

// What the route records for a call (pages/api/swag-assistant/index.ts).
async function replay(call, row, shopper) {
  const output = await callSwagTool(shopper, call.name, call.args).catch((error) => {
    throw new Error(`row ${row}: ${error.message}`);
  });
  const text = typeof output === "string" ? output : JSON.stringify(output);
  return `tool: ${call.name}(${JSON.stringify(call.args)}) -> ${text}`;
}

// The line Python's json.dumps writes by default, so check_dataset in
// ci_eval.py still reads it: ", " and ": " between items, ASCII only.
function dumps(value) {
  if (Array.isArray(value)) return `[${value.map(dumps).join(", ")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .map(([k, v]) => `${dumps(k)}: ${dumps(v)}`)
      .join(", ")}}`;
  }
  return JSON.stringify(value).replace(
    /[\u0080-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

const lines = readFileSync(DATASET, "utf8").split("\n");
const drifted = [];
let number = 0;
const out = [];
for (const line of lines) {
  if (!line.trim()) {
    out.push(line);
    continue;
  }
  number += 1;
  const row = JSON.parse(line);
  const recorded = row.variables.tool_results;
  if (recorded !== NO_TOOLS) {
    const shopper = row.metadata?.shopper;
    if (!shopper) throw new Error(`row ${number}: no metadata.shopper`);
    const fresh = [];
    for (const call of recorded.split("\n").map((l) => parseCall(l, number))) {
      fresh.push(await replay(call, number, shopper));
    }
    const regenerated = fresh.join("\n");
    if (regenerated !== recorded) {
      const changed = recorded
        .split("\n")
        .map((l, i) => (l === fresh[i] ? null : parseCall(l, number).name))
        .filter(Boolean);
      drifted.push(`row ${number} (${row.input}): ${changed.join(", ")}`);
      row.variables.tool_results = regenerated;
    }
  }
  out.push(dumps(row));
}

if (check) {
  if (drifted.length) {
    console.error(`Tool results have drifted from the tools in ${drifted.length} rows:`);
    for (const d of drifted) console.error(`  ${d}`);
    console.error("Run scripts/swag-tool-results.mjs without --check to regenerate them.");
    process.exit(1);
  }
  console.log(`All ${number} rows' tool results match the tools.`);
} else {
  writeFileSync(DATASET, out.join("\n"));
  console.log(
    drifted.length
      ? `Regenerated ${drifted.length} rows:\n  ${drifted.join("\n  ")}`
      : `All ${number} rows' tool results already match the tools.`,
  );
}
