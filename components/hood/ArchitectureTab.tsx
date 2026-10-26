import { useEffect, useRef, useState, type ReactNode } from "react";

// How the pieces fit: LaunchDarkly's own architecture, as its docs describe
// it, then ToggleWear's, then the path each demo story takes through both.
// Written to be shown on a customer call, so it names services and
// products but never this deployment's accounts, clusters or keys.

type View = "platform" | "togglewear" | "flows" | "security";

const VIEWS: { id: View; label: string }[] = [
  { id: "platform", label: "How LaunchDarkly works" },
  { id: "togglewear", label: "How ToggleWear is built" },
  { id: "flows", label: "Story flows" },
  { id: "security", label: "Keys and security" },
];

const STORAGE_KEY = "togglewear.hood.architecture";

const DOCS = "https://launchdarkly.com/docs";

export default function ArchitectureTab() {
  const [view, setView] = useState<View>("platform");
  const [restored, setRestored] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(STORAGE_KEY);
      if (VIEWS.some((v) => v.id === saved)) setView(saved as View);
    } catch {
      // Nothing usable saved.
    }
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
        {VIEWS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            aria-pressed={view === id}
            className={`rounded-full px-3 py-1 font-sohne text-xsmall font-medium transition-colors ${
              view === id
                ? "bg-grays-ld-black text-grays-white"
                : "bg-grays-01 text-grays-ld-black hover:bg-base-lime"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        {view === "platform" && <Platform />}
        {view === "togglewear" && <ToggleWear />}
        {view === "flows" && <Flows />}
        {view === "security" && <Security />}
      </div>
    </div>
  );
}

// ---- Building blocks ----

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[16px] border border-grays-hairline p-4">
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

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-sohne-mono text-xsmall-mono text-grays-ld-black">{children}</span>;
}

type Tone = "ld" | "app" | "outside";

const BOX_TONES: Record<Tone, string> = {
  ld: "bg-grays-ld-black text-grays-white",
  app: "border border-grays-02 bg-grays-white text-grays-ld-black",
  outside: "bg-grays-01 text-grays-ld-black",
};

function Box({
  title,
  detail,
  parts,
  tone,
  className = "",
}: {
  title: string;
  detail?: string;
  parts?: string[];
  tone: Tone;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 rounded-[12px] px-3.5 py-3 ${BOX_TONES[tone]} ${className}`}>
      <span className="font-sohne text-small font-medium">{title}</span>
      {detail && (
        <span className={`font-sohne text-xsmall ${tone === "ld" ? "text-grays-03" : "text-grays-04"}`}>
          {detail}
        </span>
      )}
      {parts && (
        <span className="flex flex-wrap gap-1">
          {parts.map((part) => (
            <span
              key={part}
              className={`rounded-full px-2 py-0.5 font-sohne text-[11px] ${
                tone === "ld" ? "bg-grays-06 text-grays-01" : "bg-grays-01 text-grays-ld-black"
              }`}
            >
              {part}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

// A vertical connector between boxes, with what travels along it.
function Down({ label, up = false }: { label: string; up?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1 pl-6">
      <span aria-hidden="true" className="font-sohne-mono text-xsmall-mono text-grays-03">
        {up ? "↑" : "↓"}
      </span>
      <span className="font-sohne text-xsmall text-grays-04">{label}</span>
    </div>
  );
}

// A sideways connector, for the middle column of the ToggleWear diagram.
function Across({ toRight, toLeft }: { toRight: string; toLeft: string }) {
  return (
    <div className="flex flex-col justify-center gap-2 px-1 font-sohne text-[11px] leading-snug text-grays-04">
      <span>
        <span aria-hidden="true" className="text-grays-03">→ </span>
        {toRight}
      </span>
      <span>
        <span aria-hidden="true" className="text-grays-03">← </span>
        {toLeft}
      </span>
    </div>
  );
}

// ---- How LaunchDarkly works ----

function Platform() {
  return (
    <>
      <Card title="How a flag change reaches an app">
        <div className="flex flex-col">
          <Box
            tone="outside"
            title="Someone changes a flag"
            detail="In the LaunchDarkly app, or from the REST API, Terraform, a trigger, a schedule or a guarded rollout's next step."
          />
          <Down label="saved, then sent over the stream" />
          <Box
            tone="ld"
            title="LaunchDarkly's flag delivery network"
            detail="A content delivery network in front of LaunchDarkly's core services, which span several cloud availability zones."
          />
          <Down label="a long-lived streaming connection per SDK; polling where streaming isn't possible" />
          <div className="grid grid-cols-3 gap-2">
            <Box tone="app" title="Server-side SDKs" detail="Download every flag's rules and evaluate locally, in memory." />
            <Box tone="app" title="Client-side SDKs" detail="Receive the values for the one person using the app." />
            <Box tone="app" title="Edge SDKs" detail="Read the rules from the edge platform's own store." />
          </div>
          <Down label="events, sent back in batches" up />
          <Box
            tone="ld"
            title="Events"
            detail="Which variation each context got, plus the metric events the app tracks. They feed flag insights, the Contexts list, experiments, guarded rollouts and AI metrics."
          />
        </div>
        <DocsLink href={`${DOCS}/home/getting-started/architecture`}>LaunchDarkly architecture</DocsLink>
      </Card>

      <Card title="Where a flag is evaluated">
        <Bullets
          items={[
            <>
              <b className="font-medium text-grays-ld-black">Server-side and edge SDKs</b> evaluate
              with embedded rules, so an evaluation is a lookup in memory, not a network call.
              Server-side SDKs use a secret SDK key, because they download every rule in the
              environment; edge SDKs read the rules LaunchDarkly has already pushed to the edge
              platform, and use the client-side ID.
            </>,
            <>
              <b className="font-medium text-grays-ld-black">Client-side SDKs</b> (browsers and
              mobile apps) ask LaunchDarkly to evaluate for their one context, and get back only the
              values. The rules, targeting lists and other people&apos;s values never reach the
              device. Only flags marked as available to client-side SDKs are sent.
            </>,
            <>
              <b className="font-medium text-grays-ld-black">AI SDKs</b> work like server-side SDKs:
              they choose the AgentControl config variation locally, from embedded rules.
            </>,
          ]}
        />
        <DocsLink href={`${DOCS}/sdk/concepts/client-side-server-side`}>Choosing an SDK type</DocsLink>
      </Card>

      <Card title="If LaunchDarkly can't be reached">
        <Bullets
          items={[
            "An SDK that has connected keeps serving from its in-memory copy, and catches up when the connection comes back.",
            "An SDK that can't connect at startup serves the fallback value written in the code, which is why every evaluation names one.",
            "A persistent store (Redis, DynamoDB) or the Relay Proxy lets new server processes start with flags even before they reach LaunchDarkly.",
          ]}
        />
        <Text>A server-side evaluation never waits on LaunchDarkly: it happens inside the app.</Text>
      </Card>

      <Card title="Optional pieces you run yourself">
        <Bullets
          items={[
            <>
              <b className="font-medium text-grays-ld-black">Relay Proxy:</b> a service inside your
              network that holds one connection to LaunchDarkly and serves many SDKs.
            </>,
            <>
              <b className="font-medium text-grays-ld-black">Data Export:</b> streams event data to
              your own warehouse or analytics tools.
            </>,
          ]}
        />
        <DocsLink href={`${DOCS}/sdk/relay-proxy`}>The Relay Proxy</DocsLink>
      </Card>
    </>
  );
}

// ---- How ToggleWear is built ----

function ToggleWear() {
  return (
    <>
      <Card title="The store and LaunchDarkly">
        <div className="grid grid-cols-[1fr_118px_1fr] gap-y-0">
          <Box
            tone="app"
            title="Browser"
            detail="Next.js pages and React"
            parts={["React SDK", "Observability", "Session Replay", "Developer toolbar"]}
          />
          <Across toRight="events, errors, replays" toLeft="this shopper's flag values, streamed" />
          <Box
            tone="ld"
            className="row-span-3"
            title="LaunchDarkly"
            detail="One project per SE, built from code by the deploy."
            parts={["Flags", "AgentControl", "Experiments", "Guarded rollouts", "Observability", "Triggers"]}
          />

          <Down label="page loads and /api calls" />
          <div />

          <Box
            tone="app"
            title="ToggleWear server"
            detail="Next.js API routes on Node.js"
            parts={["Node.js server SDK", "AI SDK", "LangChain", "Observability"]}
          />
          <Across toRight="events, AI metrics, traces" toLeft="every flag's and config's rules, streamed" />

          <Down label="model calls, through LangChain" />
          <div />
          <div />

          <Box
            tone="outside"
            title="Amazon Bedrock"
            detail="Claude, Nova and Llama models. AgentControl decides which one each call uses."
          />
        </div>
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

      <Card title="Where it runs">
        <div className="flex flex-col">
          <Box tone="outside" title="https://<name>-togglewear.launchdarklydemos.com" detail="One address per SE, in Amazon Route 53." />
          <Down label="HTTPS" />
          <Box tone="app" title="NGINX ingress" detail="TLS certificates from Let's Encrypt." />
          <Down label="to the SE's own namespace" />
          <Box
            tone="app"
            title="One pod on Amazon EKS"
            detail="The store's Docker image on Node.js 22. Its AWS access to Bedrock comes from EKS Pod Identity, so the app holds no AWS keys."
          />
        </div>
        <Text>
          A GitHub Actions workflow builds each environment: it creates the SE&apos;s LaunchDarkly
          project from code (every flag, segment, metric, config, experiment and alert), runs the
          generators for about ten minutes so the results aren&apos;t empty, then builds and deploys
          the image. Rebuilding gives a fresh copy of both.
        </Text>
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
                  <span className="w-4 shrink-0 pt-0.5 text-right font-sohne-mono text-xsmall-mono text-grays-03">
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
    where: "Only in GitHub Actions secrets, for the workflow that builds the project.",
    why: "It can change the project, so the running store never has one.",
  },
  {
    name: "Trigger URLs",
    where: "Created by the build and handed straight to the Observability alerts.",
    why: "Anyone with one can switch its flag, so it's never printed or kept in code.",
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

      <Card title="What this panel shows">
        <Text>
          Only things that are safe on a customer call: placeholder keys in the code examples, no
          account or infrastructure names, and the Live feed&apos;s descriptions of what happened,
          never a key or a shopper&apos;s data beyond their demo name.
        </Text>
      </Card>
    </>
  );
}
