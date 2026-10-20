import { useShopper } from "@/components/ui/ShopperProvider";
import OrderReviewSteps, { type OrderReviewProgress } from "./OrderReviewSteps";
import type { FraudAssessment } from "@/lib/fraudAgent";

// The agent's verdict, shown under Place Order. Jen has not drawn this —
// there is no fraud step in her checkout — so the panel borrows the hairline
// card and the type scale from the rest of the page and nothing else.
//
// The signals are listed rather than summarised because the reasoning is the
// demo. "Declined" on its own is a payment page; "declined, and here is what
// the agent saw" is AgentControl. Under them, each Order Review agent's
// part in the decision, and for a held or declined order the case note,
// which is still being written when the verdict first appears.

const TONE: Record<
  FraudAssessment["decision"],
  { border: string; title: string; label: string }
> = {
  approve: {
    border: "border-accent-purple",
    title: "text-grays-ld-black",
    label: "Order approved",
  },
  review: {
    border: "border-grays-03",
    title: "text-grays-ld-black",
    label: "Held for review",
  },
  decline: {
    border: "border-grays-ld-black",
    title: "text-grays-ld-black",
    label: "Order declined",
  },
};

export default function FraudReview({
  assessment,
  orderRef,
  steps,
  scripted,
}: {
  assessment: FraudAssessment;
  orderRef: string;
  steps: OrderReviewProgress;
  scripted: boolean;
}) {
  const tone = TONE[assessment.decision];
  const { person } = useShopper();

  return (
    <section
      // Announced rather than silently appearing, since the decision arrives
      // after a pause and a screen reader would otherwise miss it.
      role="status"
      className={`flex flex-col gap-4 rounded-[2px] border p-5 ${tone.border}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="font-sohne text-xsmall-caps font-medium uppercase text-grays-04">
            Order Review
          </p>
          <p className={`font-sohne text-main font-medium ${tone.title}`}>
            {tone.label}
          </p>
        </div>
        <p className="shrink-0 font-sohne text-xsmall text-grays-04">
          Risk {assessment.score}/100
        </p>
      </div>

      <p className="font-sohne text-small text-grays-04">
        {assessment.summary}
      </p>

      {assessment.signals.length > 0 && (
        <ul className="flex flex-col gap-2 border-t border-grays-hairline pt-4">
          {assessment.signals.map((signal) => (
            <li
              key={signal.label}
              className="flex items-start justify-between gap-3 font-sohne text-xsmall text-grays-ld-black"
            >
              <span>{signal.label}</span>
              <span className="shrink-0 text-grays-04">+{signal.points}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Said out loud because it is a demo beat in itself: switching off
          any one agent in LaunchDarkly lands here rather than breaking
          checkout. */}
      {scripted ? (
        <p className="border-t border-grays-hairline pt-4 font-sohne text-xsmall text-grays-04">
          Reviewed by the scripted rules: the Order Review agent graph is off or could not be
          reached.
        </p>
      ) : (
        <div className="border-t border-grays-hairline pt-4">
          <OrderReviewSteps steps={steps} decisionLabel={tone.label} />
        </div>
      )}

      {assessment.decision === "approve" && (
        <p className="border-t border-grays-hairline pt-4 font-sohne text-xsmall text-grays-04">
          Order <span className="font-medium text-grays-ld-black">{orderRef}</span>.
          {/* A guest has no address on file, so the receipt is not promised
              to one. */}
          {person.email
            ? `A receipt is on its way to ${person.email}.`
            : "A receipt is on its way."}
        </p>
      )}
    </section>
  );
}
