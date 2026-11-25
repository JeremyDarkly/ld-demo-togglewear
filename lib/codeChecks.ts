import type { LDClient, LDContext } from "@launchdarkly/node-server-sdk";
import type { LDJudgeResult } from "@launchdarkly/server-sdk-ai";

// The offline evals' deterministic checks (code_checks.py, next to
// ci_eval.py), run on the store's live replies while the
// response-code-checks flag serves true. Same inputs, same results, same
// reasons: code_check_cases.json is the cases both are tested against
// (scripts/check-code-checks.mjs here, check_code_checks.py there), so a
// change to one is a change to the other, and to the cases.
//
// A check looks for what is wrong, so an answer with nothing it can check
// passes. Nothing here ever changes a reply, a judge's result or a decision:
// the results only go to LaunchDarkly as events, one metric each (METRICS in
// demo_resources.py).

export type CheckResult = {
  // 1 or 0. A check can list a problem and still pass, as a wrong total with
  // the right decision does.
  score: number;
  reasons: string[];
};

export type CodeCheckKey =
  | "decision-matches-points"
  | "stylist-reply-usable"
  | "case-note-covers-the-case"
  | "demo-summary-names-decision";

export const CODE_CHECKS_FLAG = "response-code-checks";
export const CODE_CHECK_ERROR_KEY = "code-check-error";
export const JUDGE_DISAGREEMENT_KEY = "code-check-judge-disagreement";
// The score a judge passes at, as in the offline evals (judge_thresholds in
// ci_eval.py).
export const JUDGE_PASSES_AT = 0.7;

type Json = unknown;
type Answer = Record<string, Json>;

// How Python's repr shows a JSON value, so the reasons read the same as the
// ones code_checks.py writes with !r.
function pyRepr(value: Json): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string") {
    const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
    const escaped = value
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
    return quote + (quote === "'" ? escaped.replace(/'/g, "\\'") : escaped) + quote;
  }
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Answer)
      .map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`)
      .join(", ")}}`;
  }
  return String(value);
}

function parseJson(text: string): { ok: true; value: Json } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

// The AI SDK's parse_json_with_possible_fences, as code_checks.py copies it:
// JSON, JSON in a ``` fence, or JSON in a fence after a preamble.
export function parseJsonWithPossibleFences(raw: string): Json | null {
  const trimmed = raw.trim();
  let parsed = parseJson(trimmed);
  if (parsed.ok) return parsed.value;

  const stripped = trimmed
    .replace(/^```json\r?\n/, "")
    .replace(/^```\r?\n/, "")
    .replace(/\r?\n```$/, "")
    .trim();
  parsed = parseJson(stripped);
  if (parsed.ok) return parsed.value;

  const fence = /```(?:json)?\r?\n([\s\S]*?)\r?\n```/.exec(trimmed);
  if (fence) {
    parsed = parseJson(fence[1].trim());
    if (parsed.ok) return parsed.value;
  }
  return null;
}

const isObject = (value: Json): value is Answer =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// The decision the Order Decision agent filled in, as an object, or null.
function answerOf(output: string): Answer | null {
  const answer = parseJsonWithPossibleFences(output);
  return isObject(answer) ? answer : null;
}

// Passes when the decision is the one the risk points call for. The store
// acts on the decision alone, so a wrong total with the right decision
// passes, but is listed.
export function decisionMatchesPoints(
  output: string,
  expectedDecision: string | null,
  riskPoints: number | null,
): CheckResult {
  const answer = answerOf(output) ?? {};
  const decision = answer.decision ?? null;
  const score = answer.score ?? null;
  const reasons: string[] = [];
  if (Object.keys(answer).length === 0) {
    reasons.push("no decision");
  } else {
    if (decision !== expectedDecision) {
      reasons.push(`decision ${pyRepr(decision)} isn't ${pyRepr(expectedDecision)}`);
    }
    if (score !== riskPoints) {
      reasons.push(`score ${pyRepr(score)} isn't ${pyRepr(riskPoints)} points`);
    }
  }
  return { score: decision === expectedDecision ? 1 : 0, reasons };
}

// The reply as the page reads it (pickedFrom in
// pages/api/personal-stylist/index.ts): the first { to the last }.
function stylistReply(output: string): Answer | null {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  const parsed = parseJson(output.slice(start, end + 1));
  return parsed.ok && isObject(parsed.value) ? parsed.value : null;
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

// Passes when the page can use the whole reply: a note, a pairing from the
// catalog it was given (slugs), and a size the product comes in. The page
// drops a size or a pairing it can't use and keeps the note, so a reply
// that fails here still shows, with part of it missing.
export function stylistReplyUsable(
  output: string,
  sizes: string[],
  catalog: string[],
): CheckResult {
  const reply = stylistReply(output);
  const problems: string[] = [];
  // Over 50 words is listed, but the page still shows it, so only the other
  // problems fail the check.
  let failed = false;
  if (reply === null) {
    problems.push("not JSON");
    failed = true;
  } else {
    const note = reply.note;
    if (typeof note !== "string" || !note.trim()) {
      problems.push("no note");
      failed = true;
    } else if (words(note) > 50) {
      problems.push(`note is ${words(note)} words`);
    }
    const pairing = reply.pairing ?? null;
    if (typeof pairing !== "string" || !catalog.includes(pairing)) {
      problems.push(`pairing ${pyRepr(pairing)} isn't in its catalog`);
      failed = true;
    }
    const size = reply.size ?? null;
    if (sizes.length > 1 && (typeof size !== "string" || !sizes.includes(size))) {
      problems.push(`size ${pyRepr(size)} isn't one of ${sizes.join(", ")}`);
      failed = true;
    }
  }
  return { score: failed ? 0 : 1, reasons: problems };
}

// Order numbers and prices don't end a sentence, so a full stop counts only
// before a space or the end.
const SENTENCE_END = /[.!?](?:\s|$)/g;
const MARKDOWN = /(^|\n)\s*([-*#]|\d+\.)\s|\*\*/;

// Passes when the case note does what the Case Note prompt asks that code
// can check: three or four sentences, the decision, each signal's points,
// and plain text.
export function caseNoteCoversTheCase(
  output: string,
  expectedDecision: string | null,
  signalPoints: (number | string)[],
): CheckResult {
  const problems: string[] = [];
  const sentences = (output.trim().match(SENTENCE_END) ?? []).length;
  if (sentences < 3 || sentences > 4) problems.push(`${sentences} sentences`);
  const said =
    expectedDecision === "review" ? ["held", "review"] : expectedDecision === "decline" ? ["declin"] : [];
  const lower = output.toLowerCase();
  if (said.length && !said.some((word) => lower.includes(word))) {
    problems.push(`doesn't say it was ${expectedDecision === "review" ? "held" : "declined"}`);
  }
  // Sorted as text, as code_checks.py sorts them.
  for (const points of [...new Set(signalPoints.map(String))].sort()) {
    if (!output.includes(points)) problems.push(`no ${points}-point signal`);
  }
  if (MARKDOWN.test(output)) problems.push("markdown");
  return { score: problems.length ? 0 : 1, reasons: problems };
}

// The word a summary has to contain for each decision.
const DECISION_WORDS: Record<string, string> = {
  approve: "approve",
  review: "review",
  decline: "declin",
};

// Passes when the decision's summary contains the decision's word. Weak on
// purpose, a proxy for "the shopper is told the outcome": a wrong decision
// whose summary names that wrong decision passes it, and a right one put
// another way ("we've held your order") fails it. Live only, as a metric to
// compare with the stronger checks.
export function demoSummaryNamesDecision(output: string): CheckResult {
  const answer = answerOf(output) ?? {};
  const word =
    typeof answer.decision === "string" && Object.hasOwn(DECISION_WORDS, answer.decision)
      ? DECISION_WORDS[answer.decision]
      : null;
  if (word === null || typeof answer.summary !== "string") return { score: 1, reasons: [] };
  if (answer.summary.toLowerCase().includes(word)) return { score: 1, reasons: [] };
  return { score: 0, reasons: [`summary doesn't say ${pyRepr(word)}`] };
}

// Whether the response-code-checks flag serves true. Off when there is no
// client or the flag can't be read.
export async function codeChecksOn(
  client: Pick<LDClient, "variation"> | null,
  context: LDContext,
): Promise<boolean> {
  try {
    return (await client?.variation(CODE_CHECKS_FLAG, context, false)) === true;
  } catch {
    return false;
  }
}

type Track = Pick<LDClient, "track"> | null;

// A metric that failed to send is never worth a failed reply.
function send(client: Track, key: string, context: LDContext, data: object, value: number) {
  try {
    client?.track(key, context, data, value);
  } catch {
    // Nothing to do: the reply goes on without it.
  }
}

const cut = (reason: string) => reason.slice(0, 300);

// Runs the checks on one reply and sends what they found on the track data
// of the config that answered: code-check-<check> for each check that ran,
// 1 failed and 0 passed, then code-check-error once, 1 if any check threw.
// Resolves to each check's result, for comparing with a judge.
export function runCodeChecks(
  client: Track,
  context: LDContext,
  trackData: object,
  checks: Partial<Record<CodeCheckKey, () => CheckResult>>,
): Partial<Record<CodeCheckKey, CheckResult>> {
  const results: Partial<Record<CodeCheckKey, CheckResult>> = {};
  const errors: string[] = [];
  for (const [key, check] of Object.entries(checks) as [CodeCheckKey, () => CheckResult][]) {
    let result: CheckResult;
    try {
      result = check();
    } catch (err) {
      errors.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    results[key] = result;
    const failed = result.score < 1;
    send(client, `code-check-${key}`, context, { ...trackData, reason: cut(result.reasons.join("; ")) }, failed ? 1 : 0);
  }
  send(client, CODE_CHECK_ERROR_KEY, context, { ...trackData, reason: cut(errors.join("; ")) }, errors.length ? 1 : 0);
  return results;
}

// code-check-judge-disagreement: whether a check and a judge that read the
// same answer came out differently, 1 when they did and 0 when they agreed.
// Nothing is sent when the judge was skipped or errored, or gave no score.
export function sendJudgeDisagreement(
  client: Track,
  context: LDContext,
  trackData: object,
  check: CheckResult | undefined,
  judged: LDJudgeResult | undefined,
) {
  if (!check || !judged?.sampled || !judged.success || judged.errorMessage || typeof judged.score !== "number") return;
  const checkPassed = check.score >= 1;
  const judgePassed = judged.score >= JUDGE_PASSES_AT;
  send(
    client,
    JUDGE_DISAGREEMENT_KEY,
    context,
    {
      ...trackData,
      reason: cut(
        `check ${checkPassed ? "passed" : "failed"}, judge ${judged.score}` +
          (check.reasons.length ? `: ${check.reasons.join("; ")}` : ""),
      ),
    },
    checkPassed === judgePassed ? 0 : 1,
  );
}
