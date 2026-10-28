# ToggleWear

ToggleWear is LaunchDarkly's retail demo: an online store selling LaunchDarkly swag and tech gear, built so a user can walk a customer through LaunchDarkly one capability at a time. Every feature in the store is behind a flag or an AI Config, and every LaunchDarkly resource the demo needs is created by code in this repo, so each user's environment is identical and can be rebuilt from scratch in about fifteen minutes.

It replaces ToggleBank (ld-core-demo) as the core demo. Where ToggleBank covers five industries, ToggleWear covers one, in depth.

- **Storefront:** Next.js 16 (pages router), React 19, Tailwind CSS 3
- **LaunchDarkly:** React client SDK, Node server SDK, AI SDK, Observability and Session Replay
- **AI:** Amazon Bedrock through LangChain (Claude Sonnet 4.6, Claude Haiku 4.5, Claude Opus 5.5 and Amazon Nova 2 Lite)
- **Hosting:** one pod per user on the shared EKS cluster, at `https://<name>-togglewear.launchdarklydemos.com`

## Contents

- [Getting a demo environment](#getting-a-demo-environment)
- [Demo guide](#demo-guide)
  - [The shoppers](#the-shoppers)
  - [Flags](#flags)
  - [AI Configs and agents](#ai-configs-and-agents)
  - [The demo generator (Cmd+K)](#the-demo-generator-cmdk)
  - [Observability](#observability)
  - [Developer toolbar](#developer-toolbar)
  - [Under the hood](#under-the-hood)
  - [Resetting after a demo](#resetting-after-a-demo)
- [Running locally](#running-locally)
- [How provisioning works](#how-provisioning-works)
- [Repository layout](#repository-layout)
- [Making changes](#making-changes)
- [Troubleshooting](#troubleshooting)
- [Security](#security)

## Getting a demo environment

Environments are created and managed by GitHub Actions workflows, all started by hand from the **Actions** tab with **Run workflow**. Each takes your username, the part of your LaunchDarkly email before the `@`.

| Workflow | What it does |
|---|---|
| **Create Demo Environment** (`cloud_demo_environment_create.yaml`) | Builds a new environment: a LaunchDarkly project, a container image and a pod, and a DNS record. |
| **Rebuild Demo Environment (Delete + Create)** (`cloud_demo_environment_recreate.yaml`) | Deletes your environment and builds it again from the current code. Use it to pick up changes or to reset a demo that has drifted. |
| **Delete Demo Environment** (`cloud_demo_environment_deprovisioning.yaml`) | Deletes your environment: the LaunchDarkly project, its reset key and code references, the Kubernetes namespace and the DNS record. |
| **Rebuild All Demo Environments** (`cloud_demo_environment_recreate_all.yaml`) | Starts a Rebuild for every ToggleWear environment on the cluster, skipping any usernames you list. Has a dry run that only lists them. |
| **Add Code References** (`ld-add-code-references.yaml`) | Refreshes one user's code references by hand. Create and Rebuild already add them. |

A build takes around fifteen minutes, ten of which are the generators filling in experiment and rollout results (see [How provisioning works](#how-provisioning-works)). When it finishes:

- **Store:** `https://<name>-togglewear.launchdarklydemos.com`
- **LaunchDarkly project:** `<name>-togglewear`, named "ToggleWear Demo - \<name\>"

Everything is suffixed with `-togglewear` so it never collides with the same person's ToggleBank environment, which uses the bare name. Deleting one never touches the other.

## Demo guide

Each section says what to show and how to show it. The descriptions in LaunchDarkly say the same thing, so the flag list and the AI Configs list double as a script.

### The shoppers

The account menu at the top right of the store signs you in as one of four shoppers, or back out to a guest. Each shopper is a LaunchDarkly context with a `tier` and a `role`, and the four segments match on those:

| Shopper | Tier | Role | What they show |
|---|---|---|---|
| **Alex Rivera** | Gold | shopper | Member pricing, members-only products and tier progress |
| **Diane Whitaker** | Platinum | shopper | The top tier: her own hero, the deepest discount and free shipping |
| **Megan Caldwell** | none | beta | Opted into early access, so she sees drops first. Has a parcel on its way |
| **Chris Donovan** | none | developer | Staff, so he is the first ring of every rollout. Has a parcel on its way |
| **Guest** | none | shopper | Not signed in, so LaunchDarkly sees an anonymous visitor |

| Segment | Matches |
|---|---|
| Developers | `role` is `developer` |
| Beta Testers | `role` is `beta` |
| Gold Members | `tier` is `gold` |
| Platinum Members | `tier` is `platinum` |

The account menu also has **Empty** and **Refill** for the cart, and under **Simulate an incident**, **Payment outage** for flag 12 and **Search model outage** for Smart Search. Under **Developer tools** it opens LaunchDarkly's [developer toolbar](#developer-toolbar).

### Flags

Flags are numbered in the order a demo walks through them, simplest first, and the name says which capability each one shows.

| # | Flag | Capability | How to show it |
|---|---|---|---|
| 01 | Early Access Drop | Release toggle | The Early Access section on the homepage. Shown only to beta testers and developers: sign in as Megan or Chris to see it, as Alex to see it missing. Turn the flag off and it is gone for everyone. |
| 02 | Swag Tier Program | Targeting and segmentation | The Swag Tier Status card on `/account`. Served to developers, beta testers and both member tiers, then 50/50 to everyone else. |
| 03 | Gift Unlock Teaser | Flag prerequisite | The "points away from your next gift" strip inside that card. Requires 02, so turning 02 off hides it too, while it still reads On. |
| 04 | Live Order Tracking | Progressive rollout | Live parcel tracking on `/account`. Beta testers and developers have it now; everyone else arrives through a five-stage rollout (1% to 50%, five days a stage). Sign in as Megan or Chris. |
| 05 | Catalog API v2 | Debugging with Observability | Evaluated on the server. Turn it on and the store breaks five different ways (see below), then follow each one through Observability and turn the flag off to fix them all. An open product page picks up the change within a second or two, with no reload. Resting state: off. |
| 06 | Live Inventory Service | Guarded release, healthy | A guarded rollout that advances to 100% by itself because every metric improves. Already run at build time; run it again live with the generator. |
| 07 | Order Pipeline v2 | Guarded release, failed | A guarded rollout whose error rate and latency climb until LaunchDarkly rolls it back automatically. Already run at build time; run it again live with the generator. |
| 08 | Announcement Banner Offer | Experiment | The bar across the top of every page. Members get their own message, returning shoppers with a cart get the Cart Recovery agent's reminder, and guests are split between three offers. |
| 09 | Complete Your Look Picks | Experiment | The three picks on the cart page: cheap add-ons, pricier picks or best sellers, measured on order revenue. |
| 10 | Express Checkout | Funnel experiment | One-tap PayPal and Apple Pay buttons at checkout, measured on the purchase funnel from product view to placed order. |
| 11 | Referral Offer | Experiment | What the referral card on `/account` offers, measured on links copied. |
| 12 | New Payment Processor | Kill switch (trigger) | Turn on **Payment outage** in the account menu and place four orders. Each one fails, an alert on `PaymentProcessorError` fires, and its trigger turns the flag off about two minutes later. The next order goes through. Resting state: on. |
| 13 | Card Testing Protection | Auto-enable trigger | Start the Card Testing generator. Declined $1 charges set off an alert on `CardDeclinedError`, and its trigger turns the flag on about two minutes later. Resting state: off. |
| 14 | Recommendation Engine | Adaptive trigger | Start the Recommendation Engine generator. Failed recommendations set off the adaptive trigger, which switches the default rule to Best Sellers about two minutes later. Resting state: Personalized Picks. |

**Flag 05's five errors**, each in its own place in the store, so a user can show one at a time:

1. Open a one-size item, such as the Bucket Hat or any tech item, and the page crashes.
2. Open the Checkerboard Socks and the page is slow, then times out on the server.
3. Open the ToggleWear Hoodie and its badge says "Stock unavailable".
4. On the hoodie, click **Size Guide** and it fails.
5. On the hoodie, click **Add to Cart** and it is refused.

All five show up in Observability under Errors, Logs, Traces and Session Replay.

**The experiments** (08 to 11, and Cart Recovery) are started at build time and already have results. To add more while you watch, start that experiment's generator. The store also sends the same events, so a visit you click through yourself lands in the results.

### AI Configs and agents

Every model call in the store goes through an AI Config, so the model, the prompt and the tools can all be changed in LaunchDarkly without a deploy. Each one records duration, tokens, cost and errors per variation on its Monitoring tab, and the judges add their scores there too.

**Swag Assistant** (completion). The chat button at the bottom right.

- Everyone gets **Standard**: Amazon Nova 2 Lite, short answers.
- Gold and Platinum members get **Member Concierge**: Claude Sonnet 4.6, fuller answers that compare options and explain fit.
- Both call four tools against the live catalog and the shopper's orders (`search-products`, `get-product-details`, `get-member-perks`, `get-order-status`), and share the Store Policies and Brand Voice prompt snippets.
- Shoppers can rate each reply with a thumb, which is recorded as feedback.
- **To demo:** sign in as Alex, open the chat and ask "Help me pick a hoodie". Then change the Gold and Platinum rule to Standard, and the chat header switches to Nova 2 Lite within a second. Switch the config off and the assistant falls back to scripted replies.

**Personal Stylist** (completion). The "Your stylist's take" card on every product page, written for the shopper from the product, their past orders and the catalog:

- It picks their size, which the page selects for them ("M is your stylist's pick" under the sizes), unless they have already chosen one.
- It picks one other product to go with it, shown in the card with an **Add** button. It never suggests something they have already ordered.
- A short note says how it fits and why the pairing goes with it. The model under the note says which one wrote it.
- Adding the product in the stylist's size, or adding the pairing, sends **Stylist Suggestion Added**. That metric shows whether shoppers take the advice, which the judges can't measure.
- Two variations, the same prompt on Claude Sonnet 4.6 and Claude Opus 5.5. The build already ran a guarded rollout from Sonnet to Opus to 100%.
- **To demo:** sign in as Alex and open the ToggleWear Hoodie. The stylist selects M, the size of Alex's Crewneck, and suggests something to go with it.
- **To run one live:** set the default rule back to Claude Sonnet 4.6, start a guarded rollout to Claude Opus 5.5 with AI Judge Accuracy, AI Judge Relevance, AI Completion Errors and Stylist Suggestion Added as metrics and automatic rollback on, then start one of the two Personal Stylist generators. One walks the rollout to 100%; the other has Opus's judge scores and shoppers' adds slip until LaunchDarkly rolls it back, which errors and latency alone would never catch.

**Smart Search** (completion). The "Picks for your search" row in the search panel: up to three products that fit what the shopper meant, each with a one-line reason, under the usual word-match results.

- Two variations on two providers: **Llama 4 Maverick** (Meta) serves everyone, and **Claude Sonnet 4.6** (Anthropic) is the fallback. The model under the picks says which one chose them.
- An adaptive trigger switches the default rule to Claude Sonnet 4.6 when more than 3 searches fail in 5 minutes.
- **To demo:** search "something warm for a rainy conference" and the picks come from Llama 4 Maverick. Turn on **Search model outage** in the account menu and search four more times: each one says picks are unavailable. About two to three minutes later the trigger switches the model, and the next search shows picks from Claude Sonnet 4.6 with the outage still on.

**Cart Recovery** (agent). Writes the reminder in the announcement bar for a signed-in shopper who came back to a cart they left.

- Four variations, run as the Cart Recovery Offer experiment on order revenue: a reminder alone, a free sticker pack, 10% off, or the agent choosing the offer itself.
- **To demo:** sign in as Megan or Chris, choose **Refill** in the account menu, and the bar shows their line. To show a particular variation, target the shopper to it.

**Order Review** (agent graph). Six agents review every order placed at checkout. Open the Order Review agent graph in LaunchDarkly to see how they connect:

```
                 ┌─> Payment Risk ────┐
Order Intake ────┼─> Shipping Check ──┼─> Order Decision ─> Case Note
                 └─> Account History ─┘                     (only when held or declined)
```

- **Order Intake** reads the order and writes the case summary.
- **Payment Risk**, **Shipping Check** and **Account History** run at the same time, each with its own tool.
- **Order Decision** weighs their findings and approves, holds or declines, with the message the shopper sees at checkout.
- **Case Note** writes the note a person on the review team picks a held or declined order up from.

The checkout shows each agent's step as it runs. The rules the agents apply live in `lib/fraudAgent.ts`:

| To get | Do this at checkout | Why |
|---|---|---|
| **Approve** | Any ordinary order, including any one tech item on its own | Under 40 risk points |
| **Hold for review** | Put more than $800 in the cart, such as the Camera Drone and the VR Headset, or five of one item | 45 points for either one |
| **Decline** | Change the shipping ZIP to `99999`, a known reshipping address. Or combine the over-$800 total with five of one item | 70 points or more |

To show changing an agent without a deploy, lower the review threshold in the Order Decision agent's instructions from 40 to 30. An ordinary order with any signal at all then starts getting held.

**Judges.** Four judge AI Configs score the other configs' output from 0 to 1, and their scores are metrics that guarded rollouts and experiments can use:

| Judge | Scores | Model |
|---|---|---|
| Accuracy | Swag Assistant, Personal Stylist and Cart Recovery: whether the facts match the data and store policies | Claude Haiku 4.5 |
| Relevance | Swag Assistant and Personal Stylist: whether it answers what the shopper needs | Claude Haiku 4.5 |
| Decision Policy | Order Decision: whether the decision is the one the risk points call for | Claude Sonnet 4.6 |
| Shopper Message | Order Decision: whether the message to the shopper is clear and honest | Claude Haiku 4.5 |

**Playgrounds, datasets and optimizations.** The build also creates:

- Four datasets of real inputs captured from the store, one each for Order Decision, Case Note, Personal Stylist and Swag Assistant.
- A playground for each, comparing two models on that dataset: Order Decision and Case Note on Sonnet 4.6 against Haiku 4.5, Personal Stylist on Sonnet 4.6 against Opus 5.5, and the Swag Assistant's two variations.
- Two agent optimizations with a finished run already in them: **order-decision-cost**, which looks for a cheaper model for Order Decision, and **case-note-quality**, which looks for a better case note.

Playgrounds can't call Bedrock, so they run Nova 2 Lite as GPT-6 Luna instead. The Claude rows run on the account's Anthropic connection.

### The demo generator (Cmd+K)

Press **Cmd+K** (Ctrl+K off a Mac) on any page to open the demo generator. It plays the part of ToggleWear's services and visitors for the stories that happen behind the store rather than on a page. Each entry says what it does, what to set up before starting it and when it stops.

| Group | Generator | Flag | What happens |
|---|---|---|---|
| Guarded releases | Live Inventory Service | 06 | The rollout walks to 100% on its own |
| | Order Pipeline v2 | 07 | Healthy for four minutes, then failing orders trip the automatic rollback |
| | Personal Stylist on Opus 5.5 (succeeds) | AI | Opus's notes score a little higher and shoppers add its suggestions a little more often, and the rollout reaches 100% |
| | Personal Stylist on Opus 5.5 (rolls back) | AI | Opus's judge scores and shoppers' adds slip after four minutes, and LaunchDarkly rolls it back |
| Experiments | Announcement Banner Offer | 08 | 3,000 guests, about 30 seconds |
| | Complete Your Look Picks | 09 | 3,000 shoppers, about 30 seconds |
| | Express Checkout | 10 | 3,000 shoppers through the funnel, about 30 seconds |
| | Referral Offer | 11 | 3,000 signed-in shoppers, about 30 seconds |
| Triggers | Card Testing Protection | 13 | A bot tries stolen cards until the flag turns on |
| | Recommendation Engine | 14 | Recommendations time out until the trigger switches to Best Sellers |

The guarded-release generators wait for you to start the rollout in LaunchDarkly, then send traffic until it finishes or rolls back.

### Observability

The browser SDK runs the Observability and Session Replay plugins, and the server SDK runs Observability, so errors, logs, traces and replays from both sides arrive in your project. The AI routes also record each agent run as a conversation under **Monitor > Traces > Conversations**, with a span for every model call and tool call.

Flag 05 is the main Observability story, and flags 07, 12, 13 and 14 and Smart Search all produce real errors as well.

### Developer toolbar

Turn on **LaunchDarkly toolbar** under **Developer tools** in the account menu and LaunchDarkly's [developer toolbar](https://launchdarkly.com/docs/home/getting-started/dev-toolbar) opens in the bottom-left corner. It lists the flags this browser is evaluating, shows its evaluations and custom events as they happen, and can override a flag for this browser only, without changing its targeting in LaunchDarkly. Sign in from the toolbar the first time.

- **To demo:** sign in as Alex, then override flag 01 to on in the toolbar and the Early Access section appears for him, while his targeting in LaunchDarkly still says off. Add something to the cart and the toolbar's Events tab shows the `add-to-cart` event.
- **Only browser flags:** flag 05, the generator's scenarios and the AI Configs are evaluated on the server, so the toolbar can't override them.
- **Switching it off clears every override**, straight away. Overrides are also dropped when a new tab opens without the toolbar, so one demo can't leave a hidden override behind for the next.
- **On a hosted environment** it only works once the domain is allowed. An organization admin adds `*.launchdarklydemos.com` once under **Organization settings > Integrations > LaunchDarkly Developer Toolbar** (the "Allowed domains" field), which covers every user's `<name>-togglewear` site, and it takes up to five minutes to apply ([safe domains](https://launchdarkly.com/docs/home/getting-started/dev-toolbar-using)). Localhost is always allowed. LaunchDarkly's advice to keep it out of production is about real customers seeing it; here it stays off until someone driving the demo switches it on.

### Under the hood

The **`</>`** button in the header opens a panel beside the store for showing what it is doing in LaunchDarkly. On a laptop or larger screen it docks: the store moves over and lays itself out for the space left, so the Swag Assistant and everything else stay usable while the panel is open. It stays open, on the same tab, as you move around the store, and Escape closes it.

- **Live:** what the server is doing, as it happens. Flag evaluations and the reason for each, which AgentControl config variation each shopper was served, model and tool calls with their tokens and time, judge scores, errors, and the changes LaunchDarkly streams in. Each AI request is one line with its model, time, tokens and judge scores; click it for the steps in order, and click a long line, like a judge's explanation, to read all of it. Filter it to Flags, AI, Errors or Generator. Browser flags aren't in it, since they never reach the server; the developer toolbar shows those.
- **Code:** how to do each thing in code, from LaunchDarkly's docs, in the SDKs customers ask about (Node.js, Python, Go, Java, React, JavaScript, iOS, Android). Grouped like the docs, from getting started through releases, experimentation, AgentControl, Observability, infrastructure and developer tools, with search, a copy button and a link to the docs page for each. Pick a language once and every example shows it. Where ToggleWear does the same thing, the example says which file. The new AI SDK is marked open beta and the one ToggleWear uses is marked legacy, as the docs label them.
- **Architecture:** how LaunchDarkly gets a flag to an app, how ToggleWear is built and where it runs, the path each demo story takes step by step, and which key lives where. Deep dives covers the detail engineers ask for: how a flag picks a variation, what happens when something fails, where data goes, scale, governance, and how experiment and rollout results are measured.
- **Demo tools:** the generator (the same one as Cmd+K), the two outages, the developer toolbar, and the Reset demo button with the resting states from [Resetting after a demo](#resetting-after-a-demo).

Everything in it is safe to show on a customer call: the code uses the docs' placeholder keys, and nothing names an account, a cluster or a key. When the docs change, the examples are in `components/hood/codeExamples.ts`, each with the page it came from.

### Resetting after a demo

Most demos leave something changed. **Reset demo**, in the Demo tools tab of Under the hood, puts everything in this table back except Personal Stylist, turns both outages off and stops the generator. It shows what it changed, and LaunchDarkly's audit log records each change as made by the reset.

The button changes LaunchDarkly, which the store's SDK keys can't, so each environment gets its own reset key. DemoBuilder creates it as a service token named `togglewear-reset-<project key>`, allowed only to turn these four flags on or off, set their default rules and change Smart Search's targeting, in that project's production environment. The Rebuild workflow replaces it and the Delete workflow removes it. An environment built before the button says to put things back by hand.

To put a flag back by hand:

| Flag or config | Resting state |
|---|---|
| 05 Catalog API v2 | Off |
| 12 New Payment Processor | On, and **Payment outage** off in the account menu |
| 13 Card Testing Protection | Off |
| 14 Recommendation Engine | Default rule on Personalized Picks (an adaptive trigger doesn't switch it back) |
| Personal Stylist | Default rule on whichever model you want to start from |
| Smart Search | Default rule on Llama 4 Maverick (an adaptive trigger doesn't switch it back), and **Search model outage** off in the account menu |

If an environment has drifted too far, run the **Rebuild** workflow.

## Running locally

**You need:**

- Node.js 22 and npm.
- A LaunchDarkly project to point at. Your demo environment's project works, or a test project built with `DemoBuilder.py` (see below).
- AWS credentials with Bedrock access in `us-east-1`, for the AI features. The app uses the standard AWS credential chain, so a signed-in AWS CLI profile is enough. Without credentials the rest of the store still works, but the AI features can't answer.

**Set up:**

```bash
npm install
```

Create `.env.local` in the repo root:

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_LD_CLIENT_KEY` | The project's client-side ID, from the production environment |
| `LD_SDK_KEY` | The production environment's server-side SDK key |
| `LD_PROJECT_KEY` and `LD_RESET_TOKEN` | Optional, for the Reset demo button: the project's key, and its reset key (see [Resetting after a demo](#resetting-after-a-demo)) |
| `AWS_REGION` | Optional. Defaults to `us-east-1` |

Then:

```bash
npm run dev      # http://localhost:3000
npm run build    # production build, what the deploy runs
npm run start    # serve the production build
```

`/tokens` is a design-token reference page for checking the Tailwind config against Jen's Figma variables. It isn't part of the demo.

**If an AI coding agent starts the dev server**, Next.js 16.3 adds `AGENTS.md` and `CLAUDE.md` to the repo root. They aren't part of the project; delete them and don't commit them.

**Running the provisioning scripts locally.** The Python scripts read a `.env` in the repo root:

| Variable | What it is |
|---|---|
| `LD_API_KEY` | A LaunchDarkly API access token that can create projects |
| `LD_PROJECT_KEY` | The project to build, such as `<name>-togglewear-test` |
| `DEMO_USER` | Your username. The project's owner email and name are built from it |
| `LD_SDK_KEY` | The project's server-side SDK key, for `run_optimization.py` |
| `LD_API_KEY_USER` | Optional, unused by the current build |

```bash
cd .github/workflows/demo_provisioning_scripts
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python DemoBuilder.py
```

`DemoBuilder.py` **deletes the project first if it already exists**, so point `LD_PROJECT_KEY` at a test project, never at someone's demo.

## How provisioning works

The Create and Rebuild workflows do the same work:

1. **Build the LaunchDarkly project.** `DemoBuilder.py` creates everything in `demo_resources.py`, in this order:
   1. The project.
   2. The device and location context kinds.
   3. The segments.
   4. The metrics and the purchase funnel.
   5. The flags, with their targeting and rollouts.
   6. The prompt snippets, AI tools, judges, AI Configs and agents.
   7. The Order Review agent graph.
   8. The datasets and playgrounds.
   9. The agent optimizations.
   10. The experiments.
   11. Results: the generators run for about ten minutes so every experiment and guarded rollout has data.

   The SDK and client keys are masked in the log and handed to the next steps.
2. **Write `.env.production`** with the client ID, SDK key and AWS region, the only settings the app reads. It is built into the image, so nothing else goes in it.
3. **Create the EKS Pod Identity association**, which gives the pod its AWS credentials for Bedrock. It runs before the build because a pod started before EKS applies it comes up without credentials.
4. **Build and push the image** to the `ld-demo-togglewear` ECR repository.
5. **Deploy** `deploy_files/deploy.yaml` into the `<name>-togglewear` namespace on the shared `ld-core-demo-eks` cluster: a deployment, a service and an ingress with a TLS certificate. `update_k8s_deploy_file.py` fills in the namespace, host and image.
6. **Point DNS** at the cluster's ingress with a Route 53 CNAME for `<name>-togglewear.launchdarklydemos.com`.
7. **Add code references**, so each flag's Code references tab in LaunchDarkly shows where the store uses it. It uploads under a repository name of the user's own, `ld-demo-togglewear-<name>`, because each upload replaces whatever was under its name; with one shared name only the last person to run it would keep theirs. `.launchdarkly/coderefs.yaml` makes it match flag keys outside quotes, as in `const { earlyAccessDrop } = useFlags()`, and `.ldignore` leaves out the build scripts, which name every flag. A failure here never fails the build. The Delete workflow removes the repository.
8. **Check everything was built.** `check_build.py` reads the project back and compares it with `demo_resources.py`, since DemoBuilder logs a failed resource and carries on. If anything is missing, it lists it on the run's summary page and fails the step. The store is already online by then, and the provisioning app tells the user part of their project didn't build. To check a project by hand, run `python check_build.py <project-key>` with `LD_API_KEY` set; it only reads.
9. **Tell the user in Slack.** `notify_slack.py` sends them a direct message from the ToggleWear Slack app: their store is ready, it's up but part of the project didn't build, or it failed. They're found by their `<name>@launchdarkly.com` email. This runs after a failure too, but not after a cancel. It needs the app's bot token in the `SLACK_BOT_TOKEN` repository secret; without it, or if Slack doesn't answer, the step skips the message and the build is unaffected.

The Create and Rebuild workflows also report their progress to the demo portal's records Lambda, under the user key `<name>-togglewear`. The Delete workflow reports to a webhook instead, when it is given one.

## Repository layout

```
├── pages/                    Next.js pages
│   ├── index.tsx             Homepage
│   ├── products/             Product listing and product pages
│   ├── cart.tsx, checkout.tsx, order-confirmation.tsx
│   ├── account.tsx, about.tsx
│   ├── tokens.tsx            Design-token reference (not part of the demo)
│   └── api/                  Server routes
│       ├── swag-assistant/   Chat (Swag Assistant AI Config) and its feedback
│       ├── personal-stylist/ Stylist notes and their feedback
│       ├── cart-recovery/    The Cart Recovery agent's reminder
│       ├── order-review/     The six-agent Order Review
│       ├── catalog/, stock/  Product and stock data (flag 05 on the server)
│       └── generators.ts     The Cmd+K demo generator
├── components/               React components, grouped by page or area
│   ├── generator/            The Cmd+K panel
│   ├── hood/                 The Under the hood panel and its code examples
│   └── ui/                   Shared pieces, including the LaunchDarkly provider
├── lib/                      Data and server logic
│   ├── products.ts           The catalog: best sellers, new arrivals, tech and members-only
│   ├── shopper.ts            The shoppers and their LaunchDarkly contexts
│   ├── fraudAgent.ts         The Order Review's risk rules and thresholds
│   ├── aiServer.ts           The LaunchDarkly AI client and shared AI helpers
│   ├── llmTrace.ts           Conversation traces for the AI routes
│   ├── activity.ts           The server activity the Live tab shows
│   ├── ldServer.ts           The LaunchDarkly server client
│   ├── events.ts             The metric events the store sends
│   └── generator/            What each Cmd+K generator does
├── public/                   Images and icons
├── styles/                   Global CSS and the Söhne fonts
├── dockerfile                The production image
├── docs/api_endpoint_usage.csv  Which LaunchDarkly REST endpoints the build calls
├── .github/actions/setup-kubectl/  Installs pinned, checksum-checked kubectl for the workflows
└── .github/workflows/
    ├── cloud_demo_environment_*.yaml   The workflows above
    ├── authorize.yaml                  Stops any run Melanie or Kevin didn't start
    ├── deploy_files/deploy.yaml        The Kubernetes manifest
    ├── update_k8s_deploy_file.py
    └── demo_provisioning_scripts/
        ├── demo_resources.py   Every LaunchDarkly resource, as tables
        ├── DemoBuilder.py      Builds the project from those tables
        ├── check_build.py      Confirms the build made all of them
        ├── notify_slack.py     Tells the user in Slack how the build went
        ├── LDPlatform.py       The LaunchDarkly API client
        ├── results_generator.py, LDGeneratorsRunner.py   Build-time results
        ├── run_optimization.py Reruns an agent optimization on Bedrock
        ├── datasets/           The four playground datasets
        └── optimizations/      Recorded optimization runs the build replays
```

## Making changes

**All LaunchDarkly resources come from `demo_resources.py`.** Nothing should be created by hand in a project, because the next Rebuild won't have it. The tables there say which `LDPlatform` method each one is passed to.

**Adding or changing a flag.**

- Add an entry to `FLAGS` in `demo_resources.py`, with any targeting as `post` calls.
- Put it where it belongs in the demo script and renumber the flags after it. Only the name carries the number, never the key, so renumbering never touches the app.
- Read it in the app with the React SDK's `useFlags()`, or with the server client in `lib/ldServer.ts` for server-side flags.

**Adding a product.**

- Add it to `lib/products.ts`.
- Put its images in `public/images/products/` at 620×880.
- Check the price against the $800 review threshold, so the fraud demo still behaves (see below).

**Changing an agent's instructions, model or tools.**

1. Edit its entry in `AI_CONFIGS` or `AGENT_CONFIGS`, or the tool in `AI_TOOLS`. A new environment picks this up on its own. In an existing project, editing a tool creates a new version of it, and the variations have to be repinned to that version.
2. If the change affects what the agent sees or says, recapture its dataset in `datasets/` from the store, so the playground compares real inputs.
3. For Order Decision or Case Note, rerun its optimization so the recorded run matches, then commit the updated `optimizations/<key>.json`:

   ```bash
   cd .github/workflows/demo_provisioning_scripts
   python run_optimization.py order-decision-cost
   python run_optimization.py case-note-quality
   ```

   This needs `LD_API_KEY` and a valid `LD_SDK_KEY` for the project in `.env`, and AWS credentials with Bedrock.

**Changing the fraud rules.** The thresholds are in `lib/fraudAgent.ts`: review at 40 points, decline at 70, and 45 points each for a total over $800 or five of one item. When you change them, also update:

- The Payment Risk description in `demo_resources.py`.
- The Order Decision and Case Note datasets.
- The two optimizations.
- The table in this README.

**Deploying a change.** Push to `main`, then run **Rebuild** for your environment. The workflows build from the branch they are run on.

## Troubleshooting

**Playground or evaluation rows show Error.** The Claude models in Playgrounds use the LaunchDarkly account's Anthropic connection, and the evaluation judge is Claude too, so an Anthropic billing or credit problem shows up as errors on every row, including the GPT ones. The store itself is unaffected, since it calls Claude through Bedrock.

**The Swag Assistant gives scripted replies.** The Swag Assistant AI Config is switched off, or the server can't reach LaunchDarkly. Check the config, then the server's `LD_SDK_KEY`.

**The AI features say they couldn't answer.** The server can't call Bedrock, which almost always means it has no AWS credentials. On a laptop, check that your AWS CLI profile is signed in. In a new demo environment, the pod probably started before EKS applied its Pod Identity association; run Rebuild.

**`run_optimization.py` says the agent "has no instructions configured".** The SDK key in `.env` isn't valid for the project, so the SDK can't read the agent. Copy the production SDK key from the project's settings.

**A guarded-release generator says it is waiting.** It needs the rollout started first. The generator's description in the Cmd+K panel says exactly what to set up.

**A trigger hasn't fired.** The alerts check once a minute, so allow about two minutes after the errors start.

## Security

This repository and its Actions logs are **public**.

- Never put a key, token, webhook URL or account ID in code, in a workflow's `echo`, or in a workflow expression that ends up in a printed script.
- Secrets from GitHub are masked automatically. Anything else a workflow generates or receives as an input has to be masked with `::add-mask::` before it is used. The Delete workflow's webhook steps show how.
- `.env`, `.env.local` and `.env.production` are git-ignored. Keep them that way.
- Every workflow starts with `authorize.yaml`, which stops the run unless Melanie or Kevin started it. The Demo Hub starts every user's Create and Rebuild with Melanie's token, so users are unaffected. If the Demo Hub's token is ever replaced with someone else's, add their GitHub account to `authorize.yaml` first.
