import { useState } from "react";
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
// Each row is one line, the start of what the agent wrote, so the card stays
// the same height from the first agent to the last and never pushes the
// page into a scroll. A row opens to the agent's whole answer, one at a
// time, for a user who wants to talk one of them through.
//
// Order Decision's row does not repeat its answer, which is the summary at
// the top of the card; it says the decision instead. Case Note only runs for
// an order that was not approved, so its row only appears once it starts,
// and stays closed until asked, being for the review team rather than the
// shopper.
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

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={`h-3 w-3 shrink-0 text-grays-03 transition-transform ${open ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function Row({
  name,
  step,
  preview,
  open,
  onToggle,
}: {
  name: string;
  step?: AgentStep;
  // What the closed row says, when it is not the start of the agent's text.
  preview?: string;
  open: boolean;
  onToggle?: () => void;
}) {
  const line =
    step?.status === "running"
      ? "Working…"
      : step?.status === "failed"
        ? "Could not finish"
        : (preview ?? step?.text ?? "");
  const expandable = Boolean(onToggle && step?.text);

  const summary = (
    <>
      <StatusMark status={step?.status} />
      <span
        className={`shrink-0 font-sohne text-small font-medium ${
          step ? "text-grays-ld-black" : "text-grays-03"
        }`}
      >
        {name}
      </span>
      <span className="min-w-0 flex-1 truncate font-sohne text-xsmall text-grays-04">
        {open ? "" : line}
      </span>
      {step?.ms !== undefined && (
        <span title={step.model} className="shrink-0 font-sohne text-xsmall text-grays-03">
          {(step.ms / 1000).toFixed(1)}s
        </span>
      )}
      {expandable && <Chevron open={open} />}
    </>
  );

  return (
    <li className="flex flex-col gap-1.5">
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center gap-2.5 rounded-[2px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple"
        >
          {summary}
        </button>
      ) : (
        <div className="flex items-center gap-2.5">{summary}</div>
      )}
      {open && step?.text && (
        <div className="ml-[26px] flex animate-fade-in flex-col gap-1 font-sohne text-xsmall">
          <p className="text-grays-04">{step.text}</p>
          {step.model && <p className="text-grays-03">{step.model}</p>}
        </div>
      )}
    </li>
  );
}

export default function OrderReviewSteps({
  steps,
  decisionLabel,
}: {
  steps: OrderReviewProgress;
  // "Held for review" and the like, once the decision is in.
  decisionLabel?: string;
}) {
  const [open, setOpen] = useState<OrderReviewAgentKey | null>(null);

  const agent = (key: OrderReviewAgentKey) => {
    const { name } = ORDER_REVIEW_AGENTS.find((a) => a.key === key)!;
    const step = steps[key];
    const isDecision = key === "fraud-decision-agent";
    const isNote = key === "case-note-agent";
    return (
      <Row
        key={key}
        name={name}
        step={step}
        preview={
          isDecision
            ? decisionLabel
            : isNote
              ? "Written for the review team"
              : undefined
        }
        open={open === key}
        onToggle={isDecision ? undefined : () => setOpen(open === key ? null : key)}
      />
    );
  };

  return (
    <ol aria-label="Order Review agents" className="flex flex-col gap-3">
      {agent("order-intake-agent")}
      <li>
        <ol className="ml-2 flex flex-col gap-3 border-l border-grays-hairline pl-4">
          {SPECIALISTS.map(agent)}
        </ol>
      </li>
      {agent("fraud-decision-agent")}
      {steps["case-note-agent"] && agent("case-note-agent")}
    </ol>
  );
}
