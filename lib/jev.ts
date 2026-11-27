import type { TokenUsage } from "@launchdarkly/ai-node";
import { decisionFor, type FraudDecision } from "@/lib/fraudAgent";

// Jev, TypeSafe's decision model, as the Order Decision agent's jev-choice
// variation (fraud-decision-agent in demo_resources.py). Jev does not write:
// it is asked one choice question about the order and answers with one of
// the options, how confident it is in it and the probability of each. So a
// variation on a TypeSafe model config is asked here instead of through
// LangChain, and the answer is mapped onto the decision the LLM variations
// fill in.
//
// The question is the variation's own: its instructions, and the options in
// model.custom.criteria, one per decision, each with what it covers. Under
// model.custom.choice_confidence_min the answer is not used, and the
// decision falls back to the one the points call for, which is the rule in
// lib/fraudAgent.ts that the LLM variations are told to apply.

const API_URL = process.env.TYPESAFE_API_URL ?? "https://api.typesafe.ai/v1/systemone";

// A first call from a process sets up TLS and takes around a second; later
// ones take well under half of one. Long enough for the first, and short
// enough to leave the review its time when Jev is down.
const TIMEOUT_MS = 3_000;

const DEFAULT_CONFIDENCE_MIN = 0.7;

// Who serves Jev, on its trace spans (lib/llmTrace.ts), in place of Bedrock.
export const JEV_PROVIDER = "typesafe";

const DECISIONS: FraudDecision[] = ["approve", "review", "decline"];

// Jev could not answer: no key, a timeout, an HTTP error or a body without
// the fields read here.
export class JevError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JevError";
  }
}

type JevVariation = {
  provider?: { name?: string };
  model?: { name?: string; custom?: Record<string, unknown> };
  instructions?: string;
};

export function isJevConfig(config: JevVariation) {
  return (config.provider?.name ?? "").toLowerCase() === "typesafe";
}

type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };

type ChoiceAnswer = { choice: string; confidence: number; probabilities: Record<string, number> };

type JevResponse = {
  model: string;
  answers: Record<string, ChoiceAnswer>;
  usage: { input_tokens: number; output_tokens?: number };
};

const need = (ok: boolean, field: string) => {
  if (!ok) throw new JevError(`Jev's answer has no ${field}`);
};

// Asks Jev questions about state. Retries once on a timeout or a 5xx, and
// throws JevError on anything else that is not an answer to every question,
// including a confidence that is not a number from 0 to 1.
export async function askJev(
  model: string,
  state: Record<string, unknown>,
  questions: Record<string, ChoiceQuestion>,
  { apiKey = process.env.TYPESAFE_API_KEY, fetchImpl = fetch } = {},
): Promise<JevResponse> {
  if (!apiKey) throw new JevError("TYPESAFE_API_KEY is not set");
  const request = () =>
    fetchImpl(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, state, questions }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  // The body is read inside the same try as the request, so a timeout while
  // it arrives is retried like one before the headers, and a body that fails
  // to arrive is a JevError.
  let res: Response | undefined;
  let text = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      res = await request();
      text = await res.text();
    } catch (err) {
      const timedOut = (err as Error).name === "TimeoutError";
      if (timedOut && attempt === 0) continue;
      throw new JevError(
        timedOut ? `Jev timed out after ${TIMEOUT_MS} ms` : `Jev could not be reached: ${(err as Error).message}`,
      );
    }
    if (res.status >= 500 && attempt === 0) continue;
    break;
  }
  if (!res?.ok) {
    throw new JevError(`Jev answered HTTP ${res?.status}: ${text.slice(0, 200)}`);
  }

  let body: JevResponse;
  try {
    body = JSON.parse(text);
  } catch {
    throw new JevError("Jev's answer is not JSON");
  }
  need(typeof body?.model === "string", "model");
  need(typeof body.usage?.input_tokens === "number", "usage.input_tokens");
  for (const name of Object.keys(questions)) {
    const answer = body.answers?.[name];
    need(typeof answer?.choice === "string", `answers.${name}.choice`);
    // A confidence outside 0 to 1 is no answer either: it would pass any
    // threshold, or none.
    const { confidence } = answer;
    need(
      typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1,
      `answers.${name}.confidence between 0 and 1`,
    );
    need(answer.probabilities !== null && typeof answer.probabilities === "object", `answers.${name}.probabilities`);
  }
  return body;
}

export type JevDecision = {
  decision: FraudDecision;
  // What Jev chose, before the threshold, and how sure it was.
  choice: FraudDecision;
  confidence: number;
  // True when the confidence was under the variation's threshold, so the
  // decision is the one the points call for rather than Jev's.
  fellBack: boolean;
  model: string;
  usage: TokenUsage;
};

// The Order Decision as Jev makes it, given the order as the specialists
// reported it and the total points their tools found.
export async function jevDecision(
  config: JevVariation,
  order: string,
  points: number,
  options?: Parameters<typeof askJev>[3],
): Promise<JevDecision> {
  const custom = config.model?.custom ?? {};
  const criteria = custom.criteria as Record<string, string> | undefined;
  if (!criteria || DECISIONS.some((d) => typeof criteria[d] !== "string")) {
    throw new JevError("The Jev variation's model.custom.criteria does not cover approve, review and decline");
  }
  // LaunchDarkly stores the criteria with their keys sorted, so the order Jev
  // is shown them in, which it leans towards the first of, is kept apart.
  const shown = Array.isArray(custom.criteria_order) ? custom.criteria_order : [];
  const keys = [...shown.filter((k): k is FraudDecision => DECISIONS.includes(k)), ...DECISIONS];
  const ordered = Object.fromEntries([...new Set(keys)].map((k) => [k, criteria[k]]));
  const threshold = Number(custom.choice_confidence_min ?? DEFAULT_CONFIDENCE_MIN);

  const response = await askJev(
    config.model?.name ?? "",
    { order_review: order, risk_points: points },
    { decision: { type: "choice", instructions: config.instructions ?? "", criteria: ordered } },
    options,
  );
  const answer = response.answers.decision;
  if (!DECISIONS.includes(answer.choice as FraudDecision)) {
    throw new JevError(`Jev chose ${answer.choice}, which is not a decision`);
  }
  const choice = answer.choice as FraudDecision;
  const fellBack = answer.confidence < (Number.isFinite(threshold) ? threshold : DEFAULT_CONFIDENCE_MIN);
  const input = response.usage.input_tokens;
  const output = response.usage.output_tokens ?? 0;
  return {
    decision: fellBack ? decisionFor(points) : choice,
    choice,
    confidence: answer.confidence,
    fellBack,
    model: response.model,
    usage: { total: input + output, input, output },
  };
}
