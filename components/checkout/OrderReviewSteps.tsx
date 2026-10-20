import {
  ORDER_REVIEW_AGENTS,
  type AgentStep,
  type OrderReviewAgentKey,
} from "@/lib/orderReview";

export type OrderReviewProgress = Partial<Record<OrderReviewAgentKey, AgentStep>>;

// The Order Review agents at work, one row each, filled in as
// pages/api/order-review streams them. The three specialists are indented
// under Order Intake because they run side by side once it hands over, which
// is the shape of the agent graph in LaunchDarkly; an audience watching the
// rows tick over is watching the graph run.
//
// Case Note only runs for an order that was not approved, so its row only
// appears once it starts.
const SPECIALISTS: OrderReviewAgentKey[] = [
  "payment-risk-agent",
  "shipping-check-agent",
  "account-history-agent",
];

function StatusMark({ status }: { status?: AgentStep["status"] }) {
  if (status === "done") {
    return (
      <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-accent-purple" aria-hidden="true">
        <circle cx="8" cy="8" r="8" fill="currentColor" />
        <path
          d="M4.75 8.25 7 10.5l4.25-4.75"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-base-orange" aria-hidden="true">
        <circle cx="8" cy="8" r="8" fill="currentColor" />
        <path d="M5.5 5.5l5 5m0-5-5 5" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "running") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent-purple" />
      </span>
    );
  }
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
      <span className="h-2.5 w-2.5 rounded-full border border-grays-02" />
    </span>
  );
}

const STATUS_WORDS: Record<AgentStep["status"], string> = {
  running: "working",
  done: "done",
  failed: "failed",
};

function Row({ name, step }: { name: string; step?: AgentStep }) {
  return (
    <li className="flex gap-3">
      <span className="pt-0.5">
        <StatusMark status={step?.status} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <p
            className={`font-sohne text-small font-medium ${
              step ? "text-grays-ld-black" : "text-grays-03"
            }`}
          >
            {name}
            <span className="sr-only">, {step ? STATUS_WORDS[step.status] : "waiting"}</span>
          </p>
          {step?.model && (
            <p className="shrink-0 font-sohne text-xsmall text-grays-03">
              {step.model}
              {step.ms !== undefined && ` · ${(step.ms / 1000).toFixed(1)}s`}
            </p>
          )}
        </div>
        {step?.text && (
          <p className="animate-fade-in font-sohne text-xsmall text-grays-04">{step.text}</p>
        )}
      </div>
    </li>
  );
}

export default function OrderReviewSteps({ steps }: { steps: OrderReviewProgress }) {
  const agent = (key: OrderReviewAgentKey) => {
    const { name } = ORDER_REVIEW_AGENTS.find((a) => a.key === key)!;
    return <Row key={key} name={name} step={steps[key]} />;
  };

  return (
    <ol aria-label="Order Review agents" className="flex flex-col gap-4">
      {agent("order-intake-agent")}
      <li>
        <ol className="ml-2 flex flex-col gap-4 border-l border-grays-hairline pl-4">
          {SPECIALISTS.map(agent)}
        </ol>
      </li>
      {agent("fraud-decision-agent")}
      {steps["case-note-agent"] && agent("case-note-agent")}
    </ol>
  );
}
