import { GROUND, Label, LIME, LINE, MUTED, OUTLINE } from "@/components/hood/ToggleWearDiagram";

// How an SDK picks a variation, in the order LaunchDarkly's evaluation
// reasons describe, then how a percentage rollout buckets a context. Same
// look as ToggleWearDiagram so the panel's pictures read as one set.

type Step = {
  question: string;
  detail: string;
  // The answer that leaves the ladder for the result on the right.
  exit?: "yes" | "no";
  result: string;
  reason: string;
};

const STEPS: Step[] = [
  {
    question: "Is targeting on?",
    detail: "Off means everyone gets the off variation",
    exit: "no",
    result: "The off variation",
    reason: "OFF",
  },
  {
    question: "Are its prerequisite flags met?",
    detail: "Each must be on and serving the chosen variation",
    exit: "no",
    result: "The off variation",
    reason: "PREREQUISITE_FAILED",
  },
  {
    question: "Is this context targeted by key?",
    detail: "The flag's individual targets",
    exit: "yes",
    result: "That target's variation",
    reason: "TARGET_MATCH",
  },
  {
    question: "Does it match a rule?",
    detail: "Checked top to bottom; the first match wins",
    exit: "yes",
    result: "The rule's variation",
    reason: "RULE_MATCH",
  },
  {
    question: "Nothing above matched",
    detail: "A rule or the default can split by percentage",
    result: "The default rule",
    reason: "FALLTHROUGH",
  },
];

const TOP = 24;
const ROW = 88;
const BOX_H = 58;
const LADDER_X = 24;
const LADDER_W = 330;
const RESULT_X = 420;
const RESULT_W = 196;

const BAR_X = 24;
const BAR_W = 592;
const BAR_Y = 512;
const EXAMPLE_BUCKET = 37212;

export default function EvaluationDiagram() {
  const exampleX = BAR_X + (BAR_W * EXAMPLE_BUCKET) / 100000;

  return (
    <svg viewBox="0 0 640 610" role="img" aria-labelledby="evaluation-diagram-title" className="h-auto w-full rounded-[12px]">
      <title id="evaluation-diagram-title">
        How a flag picks a variation: if targeting is off or a prerequisite isn&apos;t met, the off
        variation; then individual targets; then rules from top to bottom; otherwise the default
        rule. A percentage rollout hashes the context into one of 100,000 buckets.
      </title>
      <defs>
        <marker id="eval-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={LINE} />
        </marker>
      </defs>

      <rect width="640" height="610" rx="12" fill={GROUND} />

      {STEPS.map((step, i) => {
        const y = TOP + i * ROW;
        const last = i === STEPS.length - 1;
        return (
          <g key={step.reason}>
            <rect x={LADDER_X} y={y} width={LADDER_W} height={BOX_H} rx={8} fill="none" stroke={OUTLINE} strokeWidth={1.5} />
            <Label x={LADDER_X + 16} y={y + 25}>
              {step.question}
            </Label>
            <Label x={LADDER_X + 16} y={y + 43} size={11} weight={400} color={MUTED}>
              {step.detail}
            </Label>

            <line
              x1={LADDER_X + LADDER_W}
              y1={y + BOX_H / 2}
              x2={RESULT_X - 4}
              y2={y + BOX_H / 2}
              stroke={LINE}
              strokeWidth={1.5}
              markerEnd="url(#eval-arrow)"
            />
            {step.exit && (
              <Label x={(LADDER_X + LADDER_W + RESULT_X) / 2} y={y + BOX_H / 2 - 7} size={11} weight={400} color={MUTED} anchor="middle">
                {step.exit}
              </Label>
            )}

            <rect x={RESULT_X} y={y} width={RESULT_W} height={BOX_H} rx={8} fill="#3A3A3A" />
            <Label x={RESULT_X + 14} y={y + 25} size={12}>
              {step.result}
            </Label>
            <text x={RESULT_X + 14} y={y + 43} fill={LIME} fontSize={11} className="font-sohne-mono">
              {step.reason}
            </text>

            {!last && (
              <>
                <line
                  x1={LADDER_X + LADDER_W / 2}
                  y1={y + BOX_H}
                  x2={LADDER_X + LADDER_W / 2}
                  y2={y + ROW - 4}
                  stroke={LINE}
                  strokeWidth={1.5}
                  markerEnd="url(#eval-arrow)"
                />
                <Label x={LADDER_X + LADDER_W / 2 + 8} y={y + BOX_H + 19} size={11} weight={400} color={MUTED}>
                  {step.exit === "yes" ? "no" : "yes"}
                </Label>
              </>
            )}
          </g>
        );
      })}

      {/* Percentage rollouts */}
      <Label x={BAR_X} y={472}>
        Percentage rollouts
      </Label>
      <Label x={BAR_X} y={492} size={11} weight={400} color={MUTED}>
        A hash of the context&apos;s key and kind puts it in one of 100,000 buckets, the same one every time.
      </Label>

      <rect x={BAR_X} y={BAR_Y} width={BAR_W / 2} height={30} rx={6} fill={LIME} />
      <rect x={BAR_X + BAR_W / 2} y={BAR_Y} width={BAR_W / 2} height={30} rx={6} fill="#3A3A3A" />
      <Label x={BAR_X + 12} y={BAR_Y + 20} size={11} color="#191919">
        50% variation A · buckets 1 to 50,000
      </Label>
      <Label x={BAR_X + BAR_W / 2 + 12} y={BAR_Y + 20} size={11}>
        50% variation B · 50,001 to 100,000
      </Label>

      <line x1={exampleX} y1={BAR_Y + 30} x2={exampleX} y2={BAR_Y + 46} stroke={LINE} strokeWidth={1.5} />
      <Label x={exampleX} y={BAR_Y + 60} size={11} weight={400} color={MUTED} anchor="middle">
        This context: bucket 37,212, so always A
      </Label>
      <Label x={BAR_X} y={BAR_Y + 86} size={11} weight={400} color={MUTED}>
        Raising A to 70% adds buckets 50,001 to 70,000, so nobody who already has A loses it.
      </Label>
    </svg>
  );
}
