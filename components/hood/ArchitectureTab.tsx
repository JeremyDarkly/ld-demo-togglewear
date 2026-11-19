import { useEffect, useRef, useState, type ReactNode } from "react";

import EvaluationDiagram from "@/components/hood/EvaluationDiagram";
import ToggleWearDiagram from "@/components/hood/ToggleWearDiagram";
import { isEventStore } from "@/lib/eventStore";

// How the pieces fit: LaunchDarkly's own architecture, as its docs describe
// it, then ToggleWear's, then the path each demo story takes through both.
// Written to be shown on a customer call, so it names services and
// products but never this deployment's accounts, clusters or keys.

type View = "autopilot" | "platform" | "togglewear" | "flows" | "security" | "deep";

const VIEWS: { id: View; label: string; isNew?: boolean }[] = [
  { id: "autopilot", label: "Release Autopilot", isNew: true },
  { id: "platform", label: "How LaunchDarkly works" },
  { id: "togglewear", label: "How ToggleWear is built" },
  { id: "flows", label: "Story flows" },
  { id: "security", label: "Keys and security" },
  { id: "deep", label: "Deep dives" },
];

const STORAGE_KEY = "togglewear.hood.architecture";

const DOCS = "https://launchdarkly.com/docs";

export default function ArchitectureTab() {
  const [view, setView] = useState<View>("platform");
  const [autopilot, setAutopilot] = useState(false);
  const [restored, setRestored] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const views = autopilot ? VIEWS : VIEWS.filter((v) => v.id !== "autopilot");

  useEffect(() => {
    // Shown in the event stores only for now.
    const shown = isEventStore();
    setAutopilot(shown);
    let next: View = shown ? "autopilot" : "platform";
    try {
      const saved = window.sessionStorage.getItem(STORAGE_KEY);
      if (VIEWS.some((v) => v.id === saved) && (shown || saved !== "autopilot")) {
        next = saved as View;
      }
    } catch {
      // Nothing usable saved.
    }
    setView(next);
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, view);
    } catch {
      // Still works for this page load.
    }
    scrollRef.current?.scrollTo({ top: 0 });
  }, [view, restored]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap gap-1.5 px-6 py-4" role="group" aria-label="Views">
        {views.map(({ id, label, isNew }) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            aria-pressed={view === id}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-sohne text-xsmall font-medium transition-colors ${
              view === id
                ? "bg-grays-ld-black text-grays-white"
                : "bg-grays-01 text-grays-ld-black hover:bg-base-lime"
            }`}
          >
            {label}
            {isNew && (
              <span className="rounded-full bg-base-lime px-1.5 text-[10px] font-medium uppercase tracking-wide text-grays-ld-black">
                New
              </span>
            )}
          </button>
        ))}
      </div>
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        {view === "autopilot" && autopilot && <ReleaseAutopilot />}
        {view === "platform" && <Platform />}
        {view === "togglewear" && <ToggleWear />}
        {view === "flows" && <Flows />}
        {view === "security" && <Security />}
        {view === "deep" && <DeepDives />}
      </div>
    </div>
  );
}

// ---- Building blocks ----

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[16px] border border-grays-02 bg-grays-white p-4 shadow-[0_2px_6px_rgba(25,25,25,0.08)]">
      <h3 className="font-sohne text-main font-medium text-grays-ld-black">{title}</h3>
      {children}
    </section>
  );
}

function Text({ children }: { children: ReactNode }) {
  return <p className="font-sohne text-small text-grays-04">{children}</p>;
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 font-sohne text-small text-grays-04 marker:text-grays-03">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function DocsLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="self-start font-sohne text-xsmall font-medium text-grays-ld-black underline decoration-grays-02 underline-offset-4 hover:decoration-grays-ld-black"
    >
      {children} ↗
    </a>
  );
}

function Rows({ rows }: { rows: { name: string; detail: ReactNode }[] }) {
  return (
    <div className="flex flex-col divide-y divide-grays-hairline">
      {rows.map(({ name, detail }) => (
        <div key={name} className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0">
          <span className="font-sohne text-small font-medium text-grays-ld-black">{name}</span>
          <span className="font-sohne text-small text-grays-04">{detail}</span>
        </div>
      ))}
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-sohne-mono text-xsmall-mono text-grays-ld-black">{children}</span>;
}

// The docs' own diagrams, copied into public/img/hood so the panel works
// offline and doesn't depend on the docs site's image links.
function Figure({ src, alt }: { src: string; alt: string }) {
  return (
    <figure className="flex flex-col gap-1.5">
      <img src={src} alt={alt} loading="lazy" className="w-full rounded-[12px]" />
      <figcaption className="font-sohne text-[11px] text-grays-04">From LaunchDarkly&apos;s docs</figcaption>
    </figure>
  );
}

// ---- Release Autopilot ----

// The showcase pull request lives in a private copy of ToggleWear, because the
// LaunchDarkly GitHub app only runs in private repositories. It is left
// unapproved on purpose and shared by everyone who demos it, so the comment
// below is copied from it word for word and the pull request is only linked.
const AUTOPILOT_REPO = "https://github.com/launchdarkly-demos/togglewear-release-autopilot";
const SHOWCASE_PR = `${AUTOPILOT_REPO}/pull/3`;

const RECOMMENDED_FLAGS = [
  {
    key: "gift-card-redemption",
    description:
      "Shows the Gift Card field in the cart's Order Summary, enables the redeem endpoint, and takes the card balance off the order total.",
  },
  {
    key: "back-in-stock-alerts",
    description:
      "Shows the Notify me form on product pages and enables the back-in-stock signup endpoint that forwards emails to the email service.",
  },
  {
    key: "price-first-browsing",
    description: "Sorts shop listings by price, lowest first, instead of best sellers first.",
  },
];

const BOT_COMMANDS = [
  ["@launchdarkly approve", "to create and apply the flags"],
  ["@launchdarkly refine <changes>", "to adjust the plan"],
  ["@launchdarkly replan", "to discard this plan and start a fresh analysis of the PR"],
  ["@launchdarkly reject", "to decline it"],
];

const AFTER_APPROVE = [
  {
    name: "Auto-flag",
    detail: "Creates the three flags in LaunchDarkly, off for customers, and pushes a commit to the pull request that wraps each feature in its flag.",
  },
  {
    name: "Auto-release",
    detail: "Once the code is merged and deployed, each flag follows the project's flag release plan: Test first, then Production in stages, watching error rates the whole way.",
  },
  {
    name: "Auto-rollback",
    detail: "If errors go up during the rollout, that flag rolls back by itself. The other two keep going.",
  },
  {
    name: "Auto-cleanup",
    detail: "When a release finishes, it opens a pull request that removes the flag from the code, then archives the flag.",
  },
];

function ReleaseAutopilot() {
  return (
    <>
      <Card title="Release Autopilot: a flag for every risky change">
        <Text>
          The LaunchDarkly GitHub app reads every pull request, decides which changes need a flag,
          and offers to add them. After approval it creates the flags, wraps the code, rolls each
          change out safely, rolls it back if something breaks, and cleans the flag up at the end.
        </Text>
        <Text>
          Below is a real run on ToggleWear: one pull request with three unrelated features, and the
          three flags Release Autopilot recommended for it.
        </Text>
        <DocsLink href={`${DOCS}/home/release-autopilot`}>Release Autopilot</DocsLink>
      </Card>

      <section className="flex shrink-0 flex-col overflow-hidden rounded-[16px] border border-grays-02 bg-grays-white shadow-[0_2px_6px_rgba(25,25,25,0.08)]">
        <div className="flex flex-col gap-2 border-b border-grays-02 bg-grays-01 px-4 py-3">
          <div className="flex items-center gap-2 font-sohne-mono text-[11px] text-grays-04">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            launchdarkly-demos / togglewear-release-autopilot
          </div>
          <h3 className="font-sohne text-main font-medium text-grays-ld-black">
            Holiday shopping: gift cards, back-in-stock alerts and price-first browsing{" "}
            <span className="font-normal text-grays-04">#3</span>
          </h3>
          <div className="flex flex-wrap items-center gap-2 font-sohne text-xsmall text-grays-04">
            <span className="rounded-full bg-[#1F883D] px-2 py-0.5 font-medium text-grays-white">Open</span>
            Three features, two new public endpoints, nine files changed
          </div>
        </div>

        <div className="flex gap-3 p-4">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-base-lime font-sohne text-small font-bold text-grays-ld-black"
            aria-hidden="true"
          >
            →
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-[8px] border border-grays-02">
            <div className="flex items-center gap-2 border-b border-grays-02 bg-grays-01 px-3 py-2 font-sohne text-xsmall">
              <span className="font-medium text-grays-ld-black">launchdarkly</span>
              <span className="rounded-full border border-grays-02 px-1.5 text-[10px] text-grays-04">Bot</span>
              <span className="text-grays-04">commented</span>
            </div>
            <div className="flex flex-col gap-3 px-3 pb-3">
              <p className="font-sohne text-small text-grays-ld-black">
                <b className="font-medium">Feature flags recommended:</b>{" "}
                {RECOMMENDED_FLAGS.map(({ key }, i) => (
                  <span key={key}>
                    <Mono>{key}</Mono>
                    {i < RECOMMENDED_FLAGS.length - 1 ? ", " : ""}
                  </span>
                ))}
              </p>

              <div className="flex flex-col divide-y divide-grays-02 overflow-hidden rounded-[6px] border border-grays-02">
                {RECOMMENDED_FLAGS.map(({ key, description }) => (
                  <div key={key} className="flex flex-col gap-1 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-[4px] bg-base-lime/40 px-1.5 py-0.5">
                        <Mono>{key}</Mono>
                      </span>
                      <span className="font-sohne text-[11px] text-grays-04">boolean · maintainer: PR owner</span>
                    </div>
                    <span className="font-sohne text-xsmall text-grays-04">{description}</span>
                  </div>
                ))}
              </div>

              <p className="font-sohne text-xsmall text-grays-04">
                <b className="font-medium text-grays-ld-black">Rationale:</b> This PR ships three
                unrelated customer-facing changes, two new public endpoints with forms on the cart
                and product pages and a new sort order for every listing, and none of them is behind
                a flag. One flag per feature lets each owner turn theirs on and off on its own
                schedule.
              </p>

              <div className="flex flex-col gap-1">
                <span className="font-sohne text-xsmall font-medium text-grays-ld-black">Reply with:</span>
                <ul className="flex flex-col gap-0.5 font-sohne text-xsmall text-grays-04">
                  {BOT_COMMANDS.map(([command, what]) => (
                    <li key={command}>
                      <Mono>{command}</Mono> {what}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-grays-02 bg-grays-ld-black px-4 py-3">
          <a
            href={SHOWCASE_PR}
            target="_blank"
            rel="noreferrer"
            className="self-start rounded-full bg-base-lime px-4 py-2 font-sohne text-small font-medium text-grays-ld-black hover:bg-grays-white"
          >
            Open pull request #3 on GitHub ↗
          </a>
          <p className="font-sohne text-[11px] text-grays-02">
            Needs access to the launchdarkly-demos GitHub org. It&apos;s shared by everyone who demos
            this, so please look but don&apos;t approve, comment or merge.
          </p>
        </div>
      </section>

      <Card title="What approving would do">
        <ol className="flex flex-col gap-2">
          {AFTER_APPROVE.map(({ name, detail }, i) => (
            <li key={name} className="flex items-start gap-3">
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-grays-ld-black font-sohne-mono text-xsmall text-grays-white"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="font-sohne text-small font-medium text-grays-ld-black">{name}</span>
                <span className="font-sohne text-xsmall text-grays-04">{detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Release plans, explained">
        <Text>
          Release Autopilot rolls a change out by following two kinds of plan, both set once per
          project under Project settings, then Release settings.
        </Text>
        <Rows
          rows={[
            {
              name: "Environment release plan: how one environment rolls out",
              detail:
                "The recipe for a single environment: who gets the change first, how much of each audience, how long each step waits, which metrics to watch, and whether to roll back by itself.",
            },
            {
              name: "Flag release plan: the order of the environments",
              detail:
                "Chains the environment plans together and says what starts each one: a flag evaluation, a deploy signal, the previous environment finishing, or a person clicking Start release.",
            },
          ]}
        />
        <div className="flex flex-col gap-2 rounded-[12px] bg-grays-01 p-3">
          <span className="font-sohne text-xsmall font-medium uppercase tracking-wide text-grays-04">
            ToggleWear&apos;s plans
          </span>
          <ol className="flex flex-col gap-1.5 font-sohne text-small text-grays-ld-black">
            <li>
              <b className="font-medium">1. Test: quick release.</b>{" "}
              <span className="text-grays-04">25%, then 50%, two minutes apart, then everyone.</span>
            </li>
            <li>
              <b className="font-medium">2. Production: guarded release</b>, started when Test finishes:
              <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-grays-04 marker:text-grays-03">
                <li>ToggleWear staff (emails ending @togglewear.com), 50% for a week</li>
                <li>Beta testers, 50% for a week</li>
                <li>Everyone: 5%, 25%, then 50%, a week each, then all shoppers</li>
                <li>Watches server and browser error rates, and rolls back by itself if either gets worse</li>
              </ul>
            </li>
          </ol>
        </div>
        <DocsLink href={`${DOCS}/home/release-autopilot/autorelease`}>Auto-release</DocsLink>
      </Card>

      <Card title="How to demo it">
        <ol className="flex flex-col gap-2.5">
          {[
            {
              step: "Start with the pull request",
              say: "A developer, or an agent, opens a pull request with three new features. Nobody adds a flag.",
              show: "The pull request at the top of this view, or open #3 on GitHub.",
            },
            {
              step: "Show the recommendation",
              say: "Release Autopilot read the code and recommended a separate flag for each risky feature, with its reasoning. One reply, @launchdarkly approve, creates the flags and wraps the code.",
              show: "The LaunchDarkly comment and its three flags. Don't approve it: it's shared.",
            },
            {
              step: "Show it doesn't flag everything",
              say: "A small change got no flag, and a reviewer can push back with a reason and get one.",
              show: "Pull requests #1 and #2 below.",
            },
            {
              step: "Show the release plans",
              say: "The team decides once how releases go. Every flag Release Autopilot creates follows that plan.",
              show: "In LaunchDarkly: Project settings, then Release settings. Environment release plans first, then the Flag release plans tab.",
            },
            {
              step: "Show a release in progress",
              say: "After merge and deploy, it releases by itself: staff first, then beta testers, then a gradual ramp, rolling back on its own if errors go up.",
              show: "In LaunchDarkly, open the Releases page, or a flag's Release tab.",
            },
            {
              step: "Close on cleanup",
              say: "When the release finishes, it opens a pull request that removes the flag and archives it, so flags don't pile up.",
              show: "What approving would do, step 4, above.",
            },
          ].map(({ step, say, show }, i) => (
            <li key={step} className="flex items-start gap-3">
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-base-lime font-sohne-mono text-xsmall font-medium text-grays-ld-black"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="font-sohne text-small font-medium text-grays-ld-black">{step}</span>
                <span className="font-sohne text-xsmall text-grays-ld-black">&ldquo;{say}&rdquo;</span>
                <span className="font-sohne text-xsmall text-grays-04">Show: {show}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="It doesn't flag everything">
        <Rows
          rows={[
            {
              name: "A delivery date worked out in the browser",
              detail: (
                <>
                  No flag needed: nothing new to call, write or break.{" "}
                  <a href={`${AUTOPILOT_REPO}/pull/1`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    Pull request #1 ↗
                  </a>
                </>
              ),
            },
            {
              name: "A new shipping fee on small orders",
              detail: (
                <>
                  No flag at first. After a one-line reason with @launchdarkly replan, it recommended
                  standard-shipping-fee.{" "}
                  <a href={`${AUTOPILOT_REPO}/pull/2`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    Pull request #2 ↗
                  </a>
                </>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}

// ---- How LaunchDarkly works ----

function Platform() {
  return (
    <>
      <Card title="How flags reach your app">
        <Figure
          src="/img/hood/flag-delivery.png"
          alt="LaunchDarkly's core infrastructure sends flags through the flag delivery network, a content delivery network for SDKs in polling mode and a multi-region streaming service for SDKs in streaming mode, to the SDKs in your application, which keep flag values in memory and have fallback values in code."
        />
        <Bullets
          items={[
            "Flags go out through the flag delivery network: a multi-region streaming service for SDKs that stream, and a content delivery network for SDKs that poll.",
            "The SDK keeps flag values in memory, so evaluating a flag never waits on a network call, and changes stream in as soon as they're saved.",
            "If LaunchDarkly can't be reached, the SDK keeps serving what it has, and at startup it serves the fallback values written in the code.",
          ]}
        />
        <DocsLink href={`${DOCS}/home/getting-started/architecture`}>LaunchDarkly architecture</DocsLink>
      </Card>

      <SafetyNets />

      <Card title="What your app sends back">
        <Bullets
          items={[
            "The SDK records which variation each context got, plus the events the app tracks: conversions, errors, AI metrics.",
            "It sends them in batches every few seconds, not one request per evaluation, so tracking adds no wait to a page.",
            "These events are what fill the Contexts list and flag insights, and what experiments, guarded rollouts and Data Export measure.",
          ]}
        />
        <DocsLink href={`${DOCS}/sdk/concepts/events`}>Analytics events</DocsLink>
      </Card>

      <Card title="Server-side and client-side SDKs">
        <Bullets
          items={[
            <>
              <b className="font-medium text-grays-ld-black">Server-side SDKs</b> download every
              flag&apos;s rules and evaluate them in memory, so they use a secret SDK key.
            </>,
            <>
              <b className="font-medium text-grays-ld-black">Client-side SDKs</b> (browsers and
              mobile apps) get only the values for the one person using the app. The rules and
              targeting lists never reach the device.
            </>,
          ]}
        />
        <DocsLink href={`${DOCS}/sdk/concepts/client-side-server-side`}>Choosing an SDK type</DocsLink>
      </Card>

      <Card title="How AgentControl works">
        <Bullets
          items={[
            "A config holds the model, its settings and the prompt or agent instructions. Targeting rules pick which variation each context gets, just like a flag.",
            "The AI SDK evaluates it on your server and fills in the prompt's variables from the context.",
            "Your app calls the model provider itself, with its own credentials. LaunchDarkly doesn't sit in between, and never holds the model keys.",
            "Afterwards the AI SDK sends back tokens, latency, errors and judge scores, which fill the config's Monitoring tab.",
          ]}
        />
        <DocsLink href={`${DOCS}/home/agentcontrol`}>AgentControl</DocsLink>
      </Card>

      <Card title="Relay Proxy (optional)">
        <Figure
          src="/img/hood/relay-proxy.png"
          alt="The same flag delivery path with a Relay Proxy between the flag delivery network and your application environment."
        />
        <Text>
          A service you run in your own network. It holds one connection to LaunchDarkly and serves
          your SDKs, so they keep getting flags even if the outside connection drops.
        </Text>
        <DocsLink href={`${DOCS}/sdk/relay-proxy`}>The Relay Proxy</DocsLink>
      </Card>
    </>
  );
}

// The six layers from launchdarkly.com/how-it-works/platform-architecture, in
// the order they take over. Breaking something takes down whatever is
// serving and hands over to the next row, so a customer can watch the app
// keep running through all six.
const NETS = [
  {
    name: "Multi-region failover",
    detail: "If a region goes down, SDKs reconnect to another region by themselves.",
  },
  {
    name: "Polling fallback",
    detail: "If streaming isn't available, SDKs fetch flags from the CDN until it's back.",
  },
  {
    name: "CDN backup",
    detail: "A new copy of the app starts from complete flag state held at 100+ edge locations.",
  },
  {
    name: "Relay Proxy or persistent store (optional)",
    detail: "Runs in your own network with the latest state, and serves even when fully disconnected.",
  },
  {
    name: "Local copy",
    detail: "Running apps serve the last-known values from memory, and mobile apps from the device.",
  },
  {
    name: "Code defaults",
    detail: "If nothing is reachable, every flag serves the default written in the code.",
  },
];

const BREAKS = [
  "Take a region down",
  "Stop streaming",
  "Start a new copy of the app",
  "Cut the app off from LaunchDarkly",
  "Take the Relay Proxy down",
  "Restart with nothing reachable",
];

const SERVING = [
  "Everything is healthy. Changes stream from the primary region and reach every app in under 200ms.",
  "The primary region is down. SDKs moved to the second region on their own.",
  "Streaming is down. SDKs are polling the CDN for flags instead.",
  "The new copy started from the flag state the CDN already had ready.",
  "LaunchDarkly can't be reached. The Relay Proxy in your network is serving the latest state.",
  "The Relay Proxy is down. The app keeps serving the values it already has in memory.",
  "Nothing is reachable. Every flag serves its default from the code.",
];

function SafetyNets() {
  const [broken, setBroken] = useState(0);
  const done = broken === NETS.length;

  return (
    <Card title="Six safety nets: why flags keep working">
      <Text>
        Each layer backs up the one before it, and each one takes over and recovers by itself. Break
        things one at a time to see who serves flags next.
      </Text>

      <ol className="flex flex-col gap-1.5">
        {NETS.map(({ name, detail }, i) => {
          const state = i < broken - 1 ? "down" : i === broken - 1 ? "serving" : "ready";
          return (
            <li
              key={name}
              className={`flex items-start gap-3 rounded-[12px] border-2 px-3 py-2.5 shadow-sm transition-colors ${
                state === "serving"
                  ? "border-grays-ld-black bg-base-lime/40"
                  : state === "down"
                    ? "border-grays-02 bg-grays-01 shadow-none"
                    : "border-grays-02 bg-grays-white"
              }`}
            >
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full font-sohne-mono text-xsmall font-medium ${
                  state === "serving"
                    ? "bg-grays-ld-black text-base-lime"
                    : state === "down"
                      ? "bg-grays-02 text-grays-04"
                      : "bg-grays-ld-black text-grays-white"
                }`}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span className="flex flex-1 flex-col gap-0.5">
                <span
                  className={`font-sohne text-small font-medium ${
                    state === "down" ? "text-grays-04 line-through" : "text-grays-ld-black"
                  }`}
                >
                  {name}
                </span>
                <span className="font-sohne text-xsmall text-grays-04">{detail}</span>
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 font-sohne text-[11px] font-medium uppercase tracking-wide ${
                  state === "serving"
                    ? "bg-grays-ld-black text-base-lime"
                    : state === "down"
                      ? "bg-grays-02 text-grays-05"
                      : "border border-grays-02 bg-grays-01 text-grays-05"
                }`}
              >
                {state === "serving" ? "Serving now" : state === "down" ? "Down" : "Standing by"}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-3 rounded-[12px] bg-grays-ld-black p-3">
        <p role="status" className="font-sohne text-small text-grays-white">
          {SERVING[broken]}{" "}
          <span className="font-medium text-base-lime">The app is still running.</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setBroken((n) => (done ? 0 : n + 1))}
            className="rounded-full bg-base-lime px-3 py-1.5 font-sohne text-xsmall font-medium text-grays-ld-black hover:bg-grays-white"
          >
            {done ? "Bring everything back" : BREAKS[broken]}
          </button>
          {broken > 0 && !done && (
            <button
              type="button"
              onClick={() => setBroken(0)}
              className="rounded-full px-3 py-1.5 font-sohne text-xsmall font-medium text-grays-02 hover:text-grays-white"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { value: "<200ms", label: "for a change to reach every connected app" },
          { value: "25ms", label: "for an SDK to start up" },
          { value: "0 bytes", label: "of targeting rules sent to the browser" },
        ].map(({ value, label }) => (
          <div
            key={value}
            className="flex flex-col gap-0.5 rounded-[12px] border-2 border-t-[6px] border-grays-02 border-t-base-lime bg-grays-white p-3 shadow-sm"
          >
            <span className="font-sora text-[20px] font-bold leading-tight text-grays-ld-black">{value}</span>
            <span className="font-sohne text-[11px] text-grays-04">{label}</span>
          </div>
        ))}
      </div>

      <DocsLink href="https://launchdarkly.com/how-it-works/platform-architecture/">
        Platform architecture
      </DocsLink>
    </Card>
  );
}

// ---- How ToggleWear is built ----

function ToggleWear() {
  return (
    <>
      <Card title="How ToggleWear is built">
        <ToggleWearDiagram />
      </Card>

      <Card title="Where each flag is evaluated">
        <Bullets
          items={[
            <>
              <b className="font-medium text-grays-ld-black">In the browser:</b> 01 to 04, 08 to 12.
              The React SDK gets the shopper&apos;s values and re-renders when they change.
            </>,
            <>
              <b className="font-medium text-grays-ld-black">On the server:</b> 05, in{" "}
              <Mono>pages/api/catalog/[slug].ts</Mono>, and every AgentControl config: Swag
              Assistant, Personal Stylist, Smart Search, Cart Recovery, the Order Review graph and
              the judges.
            </>,
            <>
              <b className="font-medium text-grays-ld-black">Only in the demo generator:</b> 06, 07,
              13 and 14. They stand for backend services with no screen in the store, so the
              generator plays those services and their traffic from the server.
            </>,
          ]}
        />
      </Card>

    </>
  );
}

// ---- Story flows ----

type Actor = "you" | "browser" | "server" | "launchdarkly" | "bedrock" | "generator";

const ACTORS: Record<Actor, { label: string; className: string }> = {
  you: { label: "You", className: "bg-base-lime text-grays-ld-black" },
  browser: { label: "Browser", className: "bg-base-cyan/20 text-grays-ld-black" },
  server: { label: "Server", className: "bg-accent-purple/15 text-grays-ld-black" },
  launchdarkly: { label: "LaunchDarkly", className: "bg-grays-ld-black text-grays-white" },
  bedrock: { label: "Bedrock", className: "bg-base-orange/20 text-grays-ld-black" },
  generator: { label: "Generator", className: "bg-grays-01 text-grays-ld-black" },
};

type Step = { actor: Actor; text: string; file?: string };

type Story = { id: string; title: string; summary: string; steps: Step[] };

const STORIES: Story[] = [
  {
    id: "release",
    title: "A release toggle (flag 01)",
    summary: "The simplest path: a browser flag, changed live.",
    steps: [
      { actor: "you", text: "Turn off 01 Early Access Drop in LaunchDarkly." },
      { actor: "launchdarkly", text: "Streams the new value to every open store, for each shopper's context." },
      { actor: "browser", text: "The React SDK updates the flag and the homepage re-renders without the Early Access section.", file: "pages/index.tsx" },
      { actor: "browser", text: "No reload, no redeploy. Turning it back on brings it back the same way." },
    ],
  },
  {
    id: "observability",
    title: "A server flag breaks the store (flag 05)",
    summary: "Evaluated on the server, found through Observability, fixed by the flag.",
    steps: [
      { actor: "you", text: "Turn on 05 Catalog API v2." },
      { actor: "launchdarkly", text: "Streams the change to the server SDK." },
      { actor: "server", text: "Hears the update and tells every open product page through /api/catalog-updates.", file: "pages/api/catalog-updates.ts" },
      { actor: "browser", text: "Asks for the product again. The server evaluates 05 for this shopper and calls the v2 catalog, which fails five different ways.", file: "pages/api/catalog/[slug].ts" },
      { actor: "server", text: "Records each failure with the Observability plugin; the browser records its side, and Session Replay records what the shopper saw." },
      { actor: "launchdarkly", text: "Shows the errors, logs, traces and replays together, with the flag that was on." },
      { actor: "you", text: "Turn 05 off and the open pages recover, again without a reload." },
    ],
  },
  {
    id: "experiment",
    title: "An experiment (flag 08)",
    summary: "Evaluations say who saw what; tracked events say what they did.",
    steps: [
      { actor: "browser", text: "Evaluates 08 Announcement Banner Offer for the shopper and shows that offer.", file: "components/layout/AnnouncementBar.tsx" },
      { actor: "launchdarkly", text: "The evaluation event records which variation this context got." },
      { actor: "browser", text: "The store tracks add-to-cart, checkout-started and order-placed, which carries the order total.", file: "lib/events.ts" },
      { actor: "launchdarkly", text: "Joins each event to the variation that context saw, and the experiment's results update." },
      { actor: "generator", text: "Adds many more visitors on demand, through the same SDK calls, so the results move while you watch." },
    ],
  },
  {
    id: "guarded",
    title: "A guarded release (flags 06 and 07)",
    summary: "LaunchDarkly advances or rolls back by itself, from metrics.",
    steps: [
      { actor: "you", text: "Start a guarded rollout, or the generator's guarded release scenario." },
      { actor: "generator", text: "Plays the backend service: evaluates the flag for many contexts and sends their error and latency events.", file: "lib/generator/scenarios.ts" },
      { actor: "launchdarkly", text: "Compares the new variation with the old at each step of the rollout." },
      { actor: "launchdarkly", text: "06 stays healthy and advances to 100%. 07's errors and latency regress, so it rolls back and tells you why." },
    ],
  },
  {
    id: "trigger",
    title: "A kill switch pulled by an alert (flag 12)",
    summary: "From an error in checkout to the flag turning off, with nobody touching it.",
    steps: [
      { actor: "you", text: "Turn on Payment outage in the account menu and place orders." },
      { actor: "browser", text: "Each charge on the new processor fails, and the Observability plugin records a PaymentProcessorError.", file: "pages/checkout.tsx" },
      { actor: "launchdarkly", text: "An Observability alert fires at more than 3 in 5 minutes. Its webhook is flag 12's trigger URL." },
      { actor: "launchdarkly", text: "The trigger turns 12 off, about two minutes after the errors." },
      { actor: "browser", text: "The next checkout evaluates 12 as off and charges through the current processor." },
    ],
  },
  {
    id: "ai",
    title: "An AI reply (Swag Assistant)",
    summary: "The model, prompt and tools all come from LaunchDarkly.",
    steps: [
      { actor: "browser", text: "Sends the shopper's message to /api/swag-assistant." },
      { actor: "server", text: "Asks the AI SDK for the Swag Assistant config for this shopper. Gold and Platinum get Member Concierge on Claude Sonnet 4.6; everyone else gets Standard on Nova 2 Lite.", file: "pages/api/swag-assistant/index.ts" },
      { actor: "server", text: "Builds the model from the config with LangChain, gives it the config's four tools, and calls it." },
      { actor: "bedrock", text: "Runs the model, which calls the tools against the live catalog and the shopper's orders." },
      { actor: "server", text: "The tracker records duration, tokens and success against the variation, and the call is traced as a conversation.", file: "lib/llmTrace.ts" },
      { actor: "server", text: "The attached judges score the reply afterwards, without holding it up, and their scores become metrics.", file: "lib/aiServer.ts" },
      { actor: "browser", text: "A thumbs up or down is recorded as feedback on the same run." },
    ],
  },
  {
    id: "fallback",
    title: "An AI model falls back by itself (Smart Search)",
    summary: "An adaptive trigger watches a metric and changes the config's default rule.",
    steps: [
      { actor: "you", text: "Turn on Search model outage and search a few times." },
      { actor: "server", text: "Each model call fails, and the server tracks smart-search-failed.", file: "pages/api/smart-search.ts" },
      { actor: "launchdarkly", text: "The adaptive trigger sees more than 3 failures in 5 minutes and switches the default rule to Claude Sonnet 4.6." },
      { actor: "server", text: "The next search gets the new variation and calls Anthropic's model instead of Meta's." },
    ],
  },
  {
    id: "graph",
    title: "An agent graph (Order Review)",
    summary: "Six agents, connected in LaunchDarkly, run for every order.",
    steps: [
      { actor: "browser", text: "Places the order, and the checkout opens a stream to /api/order-review." },
      { actor: "server", text: "Gets the Order Review agent graph for the shopper. Each agent in it is its own config, with its own model and instructions.", file: "pages/api/order-review/index.ts" },
      { actor: "bedrock", text: "Order Intake runs first, then Payment Risk, Shipping Check and Account History at the same time, then Order Decision, and Case Note when an order is held or declined." },
      { actor: "browser", text: "Shows each agent's step as it finishes, and the decision as soon as it's made." },
      { actor: "launchdarkly", text: "Records the path taken and the tokens for the graph and each agent, and two judges score Order Decision." },
    ],
  },
];

function Flows() {
  return (
    <>
      <Text>
        The path each demo story takes, step by step. The Live tab shows the same steps happening
        as you demo them.
      </Text>
      {STORIES.map((story) => (
        <Card key={story.id} title={story.title}>
          <Text>{story.summary}</Text>
          <ol className="flex flex-col gap-2.5">
            {story.steps.map((step, i) => {
              const actor = ACTORS[step.actor];
              return (
                <li key={i} className="flex gap-3">
                  <span className="w-4 shrink-0 pt-0.5 text-right font-sohne-mono text-xsmall-mono text-grays-04">
                    {i + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-start gap-2">
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 font-sohne text-[11px] font-medium ${actor.className}`}
                      >
                        {actor.label}
                      </span>
                      <span className="min-w-0 flex-1 font-sohne text-small text-grays-ld-black">
                        {step.text}
                      </span>
                    </span>
                    {step.file && (
                      <span className="font-sohne-mono text-[11px] text-grays-04">{step.file}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
      ))}
    </>
  );
}

// ---- Keys and security ----

const CREDENTIALS: { name: string; where: string; why: string }[] = [
  {
    name: "SDK key",
    where: "The server's environment, set by the deploy. Never sent to the browser.",
    why: "It downloads every rule in the environment, so it's a secret.",
  },
  {
    name: "Client-side ID",
    where: "In the page, for the React SDK.",
    why: "Not a secret: it only gets the visitor's own values, for flags marked as available to client-side SDKs.",
  },
  {
    name: "API access token",
    where: "Only used to build the LaunchDarkly project, never by the store.",
    why: "It can change the project, so the running store never has one.",
  },
  {
    name: "AWS access",
    where: "No keys at all: EKS Pod Identity gives the pod a role that can call Bedrock.",
    why: "Nothing to leak or rotate in the app.",
  },
];

function Security() {
  return (
    <>
      <Card title="Each credential and where it lives">
        <div className="flex flex-col divide-y divide-grays-hairline">
          {CREDENTIALS.map(({ name, where, why }) => (
            <div key={name} className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0">
              <span className="font-sohne text-small font-medium text-grays-ld-black">{name}</span>
              <span className="font-sohne text-small text-grays-04">{where}</span>
              <span className="font-sohne text-xsmall text-grays-04">{why}</span>
            </div>
          ))}
        </div>
        <DocsLink href={`${DOCS}/sdk/concepts/client-side-server-side#keys-and-credentials`}>Keys</DocsLink>
      </Card>

      <Card title="What the store sends about shoppers">
        <Bullets
          items={[
            "A signed-in shopper's context has their id as its key, their name and email, and what the targeting rules use: tier, role, order count and cart size. The shoppers are made up.",
            "A guest sends nothing but the fact that they're anonymous; the SDK makes up a key and keeps it in the browser.",
            "Session Replay runs with its default privacy setting, which masks text matching common patterns for personal data.",
            "Private attributes, if a customer needs them, keep an attribute usable for targeting without sending its value to LaunchDarkly.",
          ]}
        />
        <DocsLink href={`${DOCS}/sdk/features/private-attributes`}>Private attributes</DocsLink>
      </Card>
    </>
  );
}

// ---- Deep dives ----

// The questions that come up once a customer's engineers want the detail
// behind the overview. Every claim is from LaunchDarkly's docs, linked from
// its card; plan-specific features say which plan.

const FAILURES = [
  {
    name: "LaunchDarkly can't be reached while the app runs",
    detail:
      "Nothing changes for users. The SDK keeps serving the flags it holds in memory, reconnects on its own and catches up on any changes it missed.",
  },
  {
    name: "LaunchDarkly can't be reached when a server starts",
    detail:
      "Evaluations return the fallback values written in the code until the SDK connects. With a persistent store (Redis, DynamoDB or Consul), it starts from the last flags it saw instead.",
  },
  {
    name: "A browser or mobile app starts offline",
    detail:
      "It uses the flags cached on the device from the last visit, or values bootstrapped from your server, and catches up once it connects. A first visit with neither gets the code's fallbacks.",
  },
  {
    name: "A mobile app goes into the background",
    detail: "It stops receiving live updates to save battery, and catches up when it comes back to the foreground.",
  },
  {
    name: "The database behind a persistent store fails",
    detail: "Evaluations keep using the SDK's in-memory cache until it expires, then return fallback values.",
  },
  {
    name: "A Relay Proxy fails",
    detail:
      "The SDKs behind it stop getting updates, so it should run as several instances across availability zones behind a load balancer. Run any other way, it can cause more downtime than having no Relay Proxy.",
  },
];

const DATA = [
  {
    name: "What leaves your app",
    detail:
      "Contexts (only the attributes you choose to send), which variation each one got, and the events you track. With Observability on, also errors, logs, traces and session replays, masked by its privacy setting.",
  },
  {
    name: "What you can hold back",
    detail:
      "Private attributes still work in targeting rules, but the SDK removes their values before sending; LaunchDarkly shows only their names. One setting makes every attribute private except the key and kind.",
  },
  {
    name: "What never reaches a browser or phone",
    detail:
      "Flag rules, targeting lists and anyone else's values. Client-side SDKs receive only their own context's values, for flags marked as available to them.",
  },
  {
    name: "Your source code",
    detail:
      "Code references are scanned in your own CI. With context lines turned off, LaunchDarkly gets only file names, line numbers and commit IDs, never code.",
  },
];

const INSTANCES = [
  { name: "Commercial (US)", detail: "launchdarkly.com" },
  {
    name: "EU",
    detail:
      "eu.launchdarkly.com, hosted in AWS Frankfurt (eu-central-1) under EU data residency principles. Edge delivery and operational monitoring still run from the US. For Enterprise plans; a few features aren't there yet, such as Session Replay and edge SDKs.",
  },
  {
    name: "Federal",
    detail:
      "launchdarkly.us, FedRAMP compliant, with FIPS 140-3 validated encryption. AgentControl and Observability aren't available there.",
  },
];

const RUNTIMES = [
  {
    name: "Long-running servers and containers",
    detail:
      "One streaming connection per SDK instance, and every evaluation after startup happens in memory. The default setup is right for almost everyone.",
  },
  {
    name: "Serverless functions",
    detail:
      "The default works for most. If cold starts matter, the SDK can read from a persistent store that's kept up to date for it (daemon mode), or connect to a Relay Proxy in the same region. Close the SDK before the function ends so its events are sent.",
  },
  {
    name: "PHP",
    detail:
      "PHP shares nothing between requests, so it can't hold a stream. It reads flags from a store the Relay Proxy keeps up to date, or polls.",
  },
  {
    name: "Thousands of servers",
    detail:
      "The Relay Proxy in proxy mode gives them one local stream, so the firewall sees a few outbound connections instead of thousands. One instance can handle tens of thousands of connections.",
  },
  {
    name: "Browsers and mobile apps",
    detail:
      "Connect straight to LaunchDarkly, or bootstrap values from your server. They shouldn't stream through the Relay Proxy, which isn't built for that many client connections.",
  },
  {
    name: "Edge platforms",
    detail:
      "Edge SDKs read flags from the platform's own store, which LaunchDarkly keeps in sync, so an evaluation at the edge makes no call back.",
  },
  {
    name: "Networks with no internet access",
    detail: "The Relay Proxy in offline mode, on Enterprise plans.",
  },
];

const GOVERNANCE = [
  {
    name: "Who can do what",
    detail:
      "Roles are built from policies: which actions on which resources, down to a project, environment or flag. They're assigned to members, teams and API tokens.",
  },
  {
    name: "Approvals",
    detail:
      "Changes to flags, AgentControl configs, segments and experiments can go through review, like a pull request. Enterprise plans can require approval per environment. Approvals can also run through ServiceNow or a team's own approval system.",
  },
  {
    name: "Change history",
    detail:
      "Every change, with who made it, where, when and a diff. A flag can be rolled back to an earlier version from it, and it's available through the REST API.",
  },
  {
    name: "Changes as code",
    detail:
      "Flags, segments, environments and more can be managed through the REST API and the Terraform provider, so a project can be built and reviewed like code. ToggleWear's whole project is built that way.",
  },
  {
    name: "Flag cleanup",
    detail:
      "Code references show where each flag is used. When the last reference is removed, LaunchDarkly records an extinction event, and archive checks mark the flag ready for removal.",
  },
];

function DeepDives() {
  return (
    <>
      <Card title="How does a flag decide what someone gets?">
        <EvaluationDiagram />
        <Bullets
          items={[
            "Rules can match on any context attribute, on segments, and on more than one context kind at once, such as a user and their organization.",
            "Each flag splits its rollouts independently. To roll out to the same people across several flags, target a segment that holds that percentage.",
            <>
              Every evaluation can report its reason, the codes above, with the rule&apos;s position
              and ID. If the SDK can&apos;t evaluate at all (not connected yet, an unknown flag, the
              wrong type), it serves the code&apos;s fallback with the reason <Mono>ERROR</Mono>.
            </>,
          ]}
        />
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <DocsLink href={`${DOCS}/guides/flags/flag-hierarchy#flag-evaluation-sequence`}>Evaluation order</DocsLink>
          <DocsLink href={`${DOCS}/sdk/concepts/evaluation-reasons`}>Evaluation reasons</DocsLink>
          <DocsLink href={`${DOCS}/home/releases/percentage-rollouts`}>Percentage rollouts</DocsLink>
        </div>
      </Card>

      <Card title="What happens when something fails?">
        <Rows rows={FAILURES} />
        <Text>
          This is why every evaluation names a fallback: it should be the value that&apos;s safest
          if LaunchDarkly were never reached.
        </Text>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <DocsLink href={`${DOCS}/sdk/features/storing-data`}>Persistent stores</DocsLink>
          <DocsLink href={`${DOCS}/sdk/features/bootstrapping`}>Bootstrapping</DocsLink>
          <DocsLink href={`${DOCS}/sdk/relay-proxy/use-cases`}>Relay Proxy use cases</DocsLink>
        </div>
      </Card>

      <Card title="Where does our data go?">
        <Rows rows={DATA} />
        <h4 className="pt-1 font-sohne text-small font-medium text-grays-ld-black">Three separate instances</h4>
        <Rows rows={INSTANCES} />
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <DocsLink href={`${DOCS}/sdk/features/private-attributes`}>Private attributes</DocsLink>
          <DocsLink href={`${DOCS}/home/infrastructure/eu`}>EU instance</DocsLink>
          <DocsLink href={`${DOCS}/home/infrastructure/federal`}>Federal instance</DocsLink>
        </div>
      </Card>

      <Card title="How does it hold up at scale?">
        <Rows rows={RUNTIMES} />
        <Text>
          Server-side SDKs are counted as service connections: one SDK instance connected to one
          environment, measured by the minute. Client-side and edge SDKs are counted by monthly
          active contexts. The Relay Proxy reduces outbound connections, not service connections.
        </Text>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <DocsLink href={`${DOCS}/guides/infrastructure/serverless`}>Serverless</DocsLink>
          <DocsLink href={`${DOCS}/home/account/service-connections`}>Service connections</DocsLink>
        </div>
      </Card>

      <Card title="How are changes governed?">
        <Rows rows={GOVERNANCE} />
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <DocsLink href={`${DOCS}/home/account/roles`}>Roles</DocsLink>
          <DocsLink href={`${DOCS}/home/releases/approvals`}>Approvals</DocsLink>
          <DocsLink href={`${DOCS}/home/releases/change-history`}>Change history</DocsLink>
          <DocsLink href={`${DOCS}/home/flags/code-references`}>Code references</DocsLink>
        </div>
      </Card>

      <Card title="How are experiment and rollout results measured?">
        <Bullets
          items={[
            "Experiments default to frequentist analysis with sequential testing, so results can be read at any time. Fixed-horizon analysis (a t-test) suits teams that plan a sample size up front.",
            "Bayesian analysis gives results as plain probabilities, such as probability to beat the baseline. By default it shrinks results toward the control; uninformative priors are an option.",
            "Also built in: CUPED covariate adjustment to reduce noise, multiple comparisons correction, stratified sampling and sample ratio mismatch checks.",
            "Guarded rollouts compare the new variation with the original using the absolute difference and sequential testing. A regression is when the whole confidence interval lands on the worse side, and LaunchDarkly can roll back on its own. Too few contexts at any step also rolls it back.",
          ]}
        />
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <DocsLink href={`${DOCS}/guides/statistical-methodology/choosing`}>Choosing a methodology</DocsLink>
          <DocsLink href={`${DOCS}/home/releases/guarded-rollouts`}>Guarded rollouts</DocsLink>
        </div>
      </Card>
    </>
  );
}
