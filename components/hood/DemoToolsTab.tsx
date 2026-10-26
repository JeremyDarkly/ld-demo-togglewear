import { useEffect, useState, type ReactNode } from "react";

import { openDemoGenerator } from "@/components/generator/DemoGenerator";
import { IncidentRow, OutageToggle } from "@/components/ui/AccountMenu";
import { useDeveloperToolbar } from "@/components/ui/DeveloperToolbar";
import { useIncidents } from "@/components/ui/IncidentProvider";
import type { ResetResult } from "@/lib/demoReset";
import { GENERATOR_GROUPS, GENERATORS } from "@/lib/generator/catalog";
import type { DemoResetResponse } from "@/pages/api/demo-reset";

// Every control a demo needs, in one place a user can find without knowing
// the shortcuts: the same switches as the account menu and the generator
// behind Cmd+K, plus what to put back afterwards.

// The README's "Resetting after a demo" table, which is where it is kept up
// to date; this is the copy someone mid-call can see without leaving the
// store.
const RESTING_STATES: { what: string; state: string }[] = [
  { what: "05 Catalog API v2", state: "Off" },
  { what: "12 New Payment Processor", state: "On, with Payment outage off" },
  { what: "13 Card Testing Protection", state: "Off" },
  {
    what: "14 Recommendation Engine",
    state: "Default rule on Personalized Picks (its trigger doesn't switch it back)",
  },
  { what: "Personal Stylist", state: "Default rule on whichever model you start from" },
  {
    what: "Smart Search",
    state: "Default rule on Llama 4 Maverick, with Search model outage off",
  },
];

const OUTCOMES: Record<ResetResult["outcome"], string> = {
  reset: "Put back",
  unchanged: "Already there",
  failed: "Couldn't reset",
};

// Flags and the config are reset on the server, with the environment's own
// reset key; the two outages live in this browser, so they are switched off
// here.
function ResetDemo({ onReset }: { onReset: () => void }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ResetResult[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/demo-reset")
      .then((res) => res.json() as Promise<DemoResetResponse>)
      .then(({ configured }) => setConfigured(configured))
      .catch(() => setConfigured(false));
  }, []);

  async function reset() {
    setRunning(true);
    setError(false);
    onReset();
    try {
      const res = await fetch("/api/demo-reset", { method: "POST" });
      const body = (await res.json()) as DemoResetResponse;
      setConfigured(body.configured);
      setResults(body.results ?? null);
    } catch {
      setError(true);
    } finally {
      setRunning(false);
    }
  }

  if (configured === false) {
    return (
      <p className="font-sohne text-small text-grays-04">
        This environment was built before Reset demo. Run the Rebuild workflow to add it, or put
        things back by hand from the list below.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={reset}
          disabled={running || configured === null}
          className="rounded-full bg-grays-ld-black px-4 py-2 font-sohne text-small font-medium text-grays-white transition-colors hover:bg-grays-black-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-ld-black focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-60"
        >
          {running ? "Resetting…" : "Reset demo"}
        </button>
        <span className="font-sohne text-xsmall text-grays-04">Also stops the generator</span>
      </div>
      <div aria-live="polite">
        {error && (
          <p className="font-sohne text-xsmall text-grays-04">
            The store couldn&apos;t reach its server. Try again in a moment.
          </p>
        )}
        {results && (
          <ul className="flex flex-col gap-1 rounded-[12px] bg-grays-01 px-3 py-2.5 font-sohne text-xsmall">
            {results.map(({ what, outcome, detail }) => (
              <li key={what} className="flex justify-between gap-3">
                <span className="text-grays-ld-black">{what}</span>
                <span
                  title={detail}
                  className={outcome === "failed" ? "text-[#C4314B]" : "text-grays-04"}
                >
                  {OUTCOMES[outcome]}
                </span>
              </li>
            ))}
            <li className="flex justify-between gap-3">
              <span className="text-grays-ld-black">Both outages</span>
              <span className="text-grays-04">Off</span>
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-[16px] border border-grays-hairline p-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-sohne text-main font-medium text-grays-ld-black">{title}</h3>
        <p className="font-sohne text-small text-grays-04">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default function DemoToolsTab() {
  const { paymentOutage, setPaymentOutage, searchOutage, setSearchOutage } = useIncidents();
  const { toolbarOn, setToolbarOn } = useDeveloperToolbar();

  return (
    <div className="flex flex-col gap-4 overflow-y-auto px-6 py-6">
      <Section
        title="Demo data generator"
        description="Plays ToggleWear's backend services and visitors for the stories with no screen in the store: guarded releases, experiment results and triggers."
      >
        <ul className="flex flex-wrap gap-1.5">
          {GENERATOR_GROUPS.map((group) => (
            <li
              key={group}
              className="rounded-full bg-grays-01 px-2.5 py-1 font-sohne text-xsmall text-grays-ld-black"
            >
              {group} &middot; {GENERATORS.filter((g) => g.group === group).length}
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={openDemoGenerator}
            className="rounded-full bg-grays-ld-black px-4 py-2 font-sohne text-small font-medium text-grays-white transition-colors hover:bg-grays-black-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-ld-black focus-visible:ring-offset-2"
          >
            Open the generator
          </button>
          <kbd className="font-sohne-mono text-xsmall-mono text-grays-04">⌘K anywhere</kbd>
        </div>
      </Section>

      <Section
        title="Simulate an incident"
        description="These only cause the trouble. The fix comes from LaunchDarkly, which is the demo."
      >
        <div className="flex flex-col gap-2.5">
          <IncidentRow
            label="Payment outage"
            title="The new payment processor fails every charge until flag 12 is turned off"
          >
            <OutageToggle on={paymentOutage} onChange={setPaymentOutage} />
          </IncidentRow>
          <IncidentRow
            label="Search model outage"
            title="Smart Search's main model fails every search until its adaptive trigger switches to the fallback"
          >
            <OutageToggle on={searchOutage} onChange={setSearchOutage} />
          </IncidentRow>
        </div>
      </Section>

      <Section
        title="Developer tools"
        description="LaunchDarkly's developer toolbar, bottom-left: this browser's flags and events, and overrides only this browser sees. Switching it off clears them."
      >
        <IncidentRow label="LaunchDarkly toolbar" title="Opens LaunchDarkly's developer toolbar">
          <OutageToggle on={toolbarOn} onChange={setToolbarOn} tone="plain" />
        </IncidentRow>
      </Section>

      <Section
        title="After a demo"
        description="Reset demo puts everything below back, except Personal Stylist, so the next demo starts where the script expects. Run the Rebuild workflow if an environment has drifted too far."
      >
        <ResetDemo onReset={() => {
          setPaymentOutage(false);
          setSearchOutage(false);
        }} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 font-sohne text-xsmall">
          {RESTING_STATES.map(({ what, state }) => (
            <div key={what} className="contents">
              <dt className="font-medium text-grays-ld-black">{what}</dt>
              <dd className="text-grays-04">{state}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
