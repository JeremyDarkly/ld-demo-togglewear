// The Code tab's content: how to do each thing a user gets asked about, in
// the SDKs customers use, arranged like LaunchDarkly's docs. Every snippet
// is taken from the docs page it links to, checked against the current
// package names, and uses the docs' placeholder keys; nothing here is a real
// key, project or account.
//
// When the docs move on (a new SDK major, a renamed package), change the
// snippet here and keep the docs link pointing at the page it came from.

export type Lang =
  | "node"
  | "python"
  | "go"
  | "java"
  | "react"
  | "javascript"
  | "ios"
  | "android"
  | "shell"
  | "yaml"
  | "json"
  | "hcl";

export const LANG_LABELS: Record<Lang, string> = {
  node: "Node.js",
  python: "Python",
  go: "Go",
  java: "Java",
  react: "React",
  javascript: "JavaScript",
  ios: "iOS",
  android: "Android",
  shell: "Shell",
  yaml: "YAML",
  json: "JSON",
  hcl: "Terraform",
};

export type Snippet = { lang: Lang; code: string };

export type Example = {
  id: string;
  title: string;
  summary: string;
  docs: string;
  // Shown as a badge, in the docs' own words ("Open beta", "Legacy").
  status?: string;
  // Where ToggleWear does the same thing, for a user who wants to show it
  // working rather than read about it.
  inToggleWear?: string;
  snippets: Snippet[];
};

export type Section = {
  id: string;
  title: string;
  summary: string;
  examples: Example[];
};

const DOCS = "https://launchdarkly.com/docs";

export const SECTIONS: Section[] = [
  {
    id: "start",
    title: "Get started",
    summary: "Which key goes where, connecting an SDK, and shutting it down cleanly.",
    examples: [
      {
        id: "keys",
        title: "Which key goes where",
        summary:
          "Each environment has three SDK credentials. The SDK key is a secret for servers. The client-side ID is safe to ship in a browser, and the mobile key goes in apps. API access tokens are for the REST API, the CLI and Terraform, never for SDKs.",
        docs: `${DOCS}/sdk/concepts/client-side-server-side#keys-and-credentials`,
        inToggleWear: ".env.local: LD_SDK_KEY on the server, NEXT_PUBLIC_LD_CLIENT_KEY in the browser",
        snippets: [
          {
            lang: "shell",
            code: `# Server-side SDKs (Node.js, Python, Go, Java, .NET...). Secret: server only.
LAUNCHDARKLY_SDK_KEY=sdk-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Client-side JavaScript and React. Not secret: it ships in the page.
LAUNCHDARKLY_CLIENT_SIDE_ID=example-client-side-id

# iOS, Android, React Native and Flutter.
LAUNCHDARKLY_MOBILE_KEY=mob-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# REST API, CLI, Terraform and MCP. Never in application code.
LAUNCHDARKLY_ACCESS_TOKEN=api-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`,
          },
        ],
      },
      {
        id: "install",
        title: "Install and initialize",
        summary:
          "Create one client when the app starts and share it. It opens a streaming connection, downloads the environment's rules and then evaluates flags locally, in memory, with no network call per flag.",
        docs: `${DOCS}/sdk/server-side/node-js`,
        inToggleWear: "lib/ldServer.ts (server) and components/ui/LaunchDarklyProvider.tsx (browser)",
        snippets: [
          {
            lang: "node",
            code: `// npm install @launchdarkly/node-server-sdk
import { init } from '@launchdarkly/node-server-sdk';

const client = init('YOUR_SDK_KEY');

try {
  await client.waitForInitialization({ timeout: 10 });
  // initialization complete
} catch (error) {
  // timeout or SDK failed to initialize: variations return their fallbacks
}`,
          },
          {
            lang: "python",
            code: `# pip install launchdarkly-server-sdk
import ldclient
from ldclient.config import Config

ldclient.set_config(Config("YOUR_SDK_KEY"))
client = ldclient.get()

if not client.is_initialized():
    # variations return their fallbacks until it connects
    pass`,
          },
          {
            lang: "go",
            code: `// go get github.com/launchdarkly/go-server-sdk/v7
import (
    "time"

    ld "github.com/launchdarkly/go-server-sdk/v7"
)

client, _ := ld.MakeClient("YOUR_SDK_KEY", 5*time.Second)
defer client.Close()`,
          },
          {
            lang: "java",
            code: `// Maven: com.launchdarkly:launchdarkly-java-server-sdk
import com.launchdarkly.sdk.*;
import com.launchdarkly.sdk.server.*;

LDClient client = new LDClient("YOUR_SDK_KEY");`,
          },
          {
            lang: "react",
            code: `// npm install @launchdarkly/react-sdk
import { useInitializationStatus, createLDReactProvider } from '@launchdarkly/react-sdk';

const LDProvider = createLDReactProvider('example-client-side-id', {
  kind: 'user',
  key: 'example-user-key',
});

function App() {
  const { status, error } = useInitializationStatus();
  if (status === 'initializing') return <div>initializing</div>;
  if (status === 'failed') return <div>Error: {error?.message}</div>;
  return <div>Your application code</div>;
}

root.render(<LDProvider><App /></LDProvider>);`,
          },
          {
            lang: "javascript",
            code: `// npm install @launchdarkly/js-client-sdk
import { createClient } from '@launchdarkly/js-client-sdk';

const context = { kind: 'user', key: 'example-user-key' };

const client = createClient('example-client-side-id', context);
client.start();

await client.waitForInitialization({ timeout: 5 });`,
          },
          {
            lang: "ios",
            code: `// Swift Package Manager: github.com/launchdarkly/ios-client-sdk
import LaunchDarkly

let config = LDConfig(mobileKey: "example-mobile-key", autoEnvAttributes: .enabled)

let contextBuilder = LDContextBuilder(key: "example-context-key")
guard case .success(let context) = contextBuilder.build()
else { return }

LDClient.start(config: config, context: context, startWaitSeconds: 5) { timedOut in
    // timedOut: the client may not have the latest flags yet
}`,
          },
          {
            lang: "android",
            code: `// implementation("com.launchdarkly:launchdarkly-android-client-sdk:5.+")
val ldConfig = LDConfig.Builder(AutoEnvAttributes.Enabled)
    .mobileKey("example-mobile-key")
    .build()

val context = LDContext.create("example-context-key")

val client: LDClient = LDClient.init(this@BaseApplication, ldConfig, context, 0)`,
          },
        ],
      },
      {
        id: "shutdown",
        title: "Flush and shut down",
        summary:
          "Events are sent in batches. Short-lived processes (scripts, serverless functions, tests) should flush or close the client before they exit, or the last batch is lost.",
        docs: `${DOCS}/sdk/features/shutdown`,
        snippets: [
          {
            lang: "node",
            code: `// Send any queued events now and keep the client
client.flush();

// Or send them and close the connection, at the end of the process
client.close();`,
          },
          {
            lang: "python",
            code: `# Send any queued events now and keep the client
ldclient.get().flush()

# Or send them and close the connection, at the end of the process
ldclient.get().close()`,
          },
          {
            lang: "javascript",
            code: `// Send any queued events now and keep the client
client.flush();

// Or send them and close the connection
await client.close();`,
          },
        ],
      },
    ],
  },
  {
    id: "contexts",
    title: "Contexts",
    summary: "Who or what a flag is evaluated for: users, organizations, devices, or several at once.",
    examples: [
      {
        id: "context",
        title: "Describe a context",
        summary:
          "A context is the thing being targeted, with a kind, a unique key and any attributes the targeting rules need. The key also decides which bucket of a percentage rollout or experiment it lands in, so keep it stable.",
        docs: `${DOCS}/sdk/features/context-config`,
        inToggleWear: "lib/shopper.ts builds each shopper's context",
        snippets: [
          {
            lang: "node",
            code: `import * as ld from '@launchdarkly/node-server-sdk';

const context: ld.LDContext = {
  kind: 'user',
  key: 'example-user-key',
  firstName: 'Sandy',
  lastName: 'Smith',
  email: 'sandy@example.com',
  groups: ['Acme', 'Global Health Services'],
};`,
          },
          {
            lang: "python",
            code: `from ldclient import Context

context = Context.builder("example-context-key") \\
    .set("firstName", "Sandy") \\
    .set("lastName", "Smith") \\
    .set("email", "sandy@example.com") \\
    .set("groups", ["Acme", "Global Health Services"]) \\
    .build()`,
          },
          {
            lang: "go",
            code: `import "github.com/launchdarkly/go-sdk-common/v3/ldcontext"

context := ldcontext.NewBuilder("example-context-key").
    Name("Sandy").
    Build()`,
          },
          {
            lang: "java",
            code: `LDContext context = LDContext.builder("example-context-key")
  .name("Sandy")
  .build();`,
          },
          {
            lang: "javascript",
            code: `const context = {
  kind: 'user',
  key: 'example-user-key',
  firstName: 'Sandy',
  lastName: 'Smith',
  email: 'sandy@example.com',
  groups: ['Acme', 'Global Health Services'],
};`,
          },
        ],
      },
      {
        id: "multi",
        title: "Multi-contexts",
        summary:
          "Evaluate for several kinds at once, for example the user and the device they're on, or the user and their organization. Rules can target any of them, and a rollout can bucket by either.",
        docs: `${DOCS}/sdk/features/context-config`,
        snippets: [
          {
            lang: "node",
            code: `const context = {
  kind: 'multi',
  user: { key: 'example-user-key' },
  device: { key: 'example-device-key' },
};`,
          },
          {
            lang: "python",
            code: `from ldclient import Context

multi_context = Context.create_multi(
    Context.create("example-user-key"),
    Context.create("example-device-key", "device"),
)`,
          },
          {
            lang: "javascript",
            code: `const multiContext = {
  kind: 'multi',
  user: { key: 'example-user-key', name: 'Sandy' },
  organization: { key: 'example-organization-key', name: 'Acme, Inc.' },
};`,
          },
        ],
      },
      {
        id: "anonymous",
        title: "Anonymous visitors",
        summary:
          "For someone who hasn't signed in. Anonymous contexts can still be targeted and bucketed, but they're kept off the Contexts list. Client-side SDKs generate and remember the key for you.",
        docs: `${DOCS}/sdk/features/anonymous`,
        inToggleWear: "Every guest shopper before they pick an account",
        snippets: [
          {
            lang: "node",
            code: `const context = {
  kind: 'user',
  key: 'example-user-key',
  anonymous: true,
};`,
          },
          {
            lang: "python",
            code: `context = Context.builder("example-context-key").anonymous(True).build()`,
          },
          {
            lang: "javascript",
            code: `// The SDK generates a key and keeps it between visits
const anonymousUserContext = {
  kind: 'user',
  anonymous: true,
};`,
          },
        ],
      },
      {
        id: "private",
        title: "Private attributes",
        summary:
          "Use an attribute for targeting without sending its value to LaunchDarkly. The SDK evaluates with it locally and strips it from the events it sends.",
        docs: `${DOCS}/sdk/features/private-attributes`,
        snippets: [
          {
            lang: "node",
            code: `// Two attributes marked private for every context
const client = init('YOUR_SDK_KEY', {
  privateAttributes: ['email', 'address'],
});

// Or one attribute on one context
const context = {
  kind: 'user',
  key: 'example-user-key',
  email: 'sandy@example.com',
  _meta: { privateAttributes: ['email'] },
};`,
          },
          {
            lang: "python",
            code: `# Two attributes marked private
config = Config("YOUR_SDK_KEY", private_attributes=["name", "email"])

# Or every attribute
config = Config("YOUR_SDK_KEY", all_attributes_private=True)`,
          },
          {
            lang: "javascript",
            code: `const client = createClient('example-client-side-id', context, {
  allAttributesPrivate: true,
});`,
          },
        ],
      },
      {
        id: "identify",
        title: "Switch contexts when someone signs in",
        summary:
          "Client-side SDKs evaluate for one context at a time. When the visitor signs in, identify the new context and the SDK fetches their flags. Server-side SDKs take the context on every call instead.",
        docs: `${DOCS}/sdk/features/identify`,
        inToggleWear: "Picking a shopper in the account menu, or the cart changing (components/ui/LaunchDarklyProvider.tsx)",
        snippets: [
          {
            lang: "react",
            code: `import { useEffect } from 'react';
import { useLDClient } from '@launchdarkly/react-sdk';

export default function App() {
  const ldClient = useLDClient();

  useEffect(() => {
    ldClient.identify({ kind: 'user', key: 'example-context-key' });
  }, []);

  return <div>Let your feature flags fly!</div>;
}`,
          },
          {
            lang: "javascript",
            code: `await client.identify({ kind: 'user', key: 'example-user-key', name: 'Sandy' });
// flags for the new context are ready`,
          },
        ],
      },
      {
        id: "secure",
        title: "Secure mode",
        summary:
          "Stops a browser from asking for another person's flags by changing its context key. The server signs the context, and the browser SDK sends the signature along with it.",
        docs: `${DOCS}/sdk/features/secure-mode`,
        snippets: [
          {
            lang: "node",
            code: `// On the server, when rendering the page
const hash = client.secureModeHash(context);`,
          },
          {
            lang: "python",
            code: `hash = ldclient.get().secure_mode_hash(context)`,
          },
          {
            lang: "javascript",
            code: `// In the browser, with the hash the server rendered
const client = createClient('example-client-side-id', context);
client.start({ identifyOptions: { hash: 'example-server-generated-hash' } });

// and a new hash for each context you switch to
await client.identify(newContext, { hash: newHash });`,
          },
        ],
      },
    ],
  },
  {
    id: "flags",
    title: "Feature flags",
    summary: "Evaluating flags, knowing why a value was served, and reacting to changes.",
    examples: [
      {
        id: "evaluate",
        title: "Evaluate a flag",
        summary:
          "Ask for a flag's value for a context, with a fallback. The fallback is served if the SDK can't reach LaunchDarkly or the flag doesn't exist, so pick the safe one.",
        docs: `${DOCS}/sdk/features/evaluating`,
        inToggleWear: "Every flag in the store; flag 05 in pages/api/catalog/[slug].ts on the server",
        snippets: [
          {
            lang: "node",
            code: `const showFeature = await client.boolVariation('example-flag-key', context, false);

if (showFeature) {
  // application code to show the feature
} else {
  // the code to run if the feature is off
}`,
          },
          {
            lang: "python",
            code: `show_feature = client.variation("example-flag-key", context, False)

if show_feature:
    # application code to show the feature
    pass`,
          },
          {
            lang: "go",
            code: `showFeature, _ := client.BoolVariation("example-flag-key", context, false)
if showFeature {
    // Application code to show the feature
}`,
          },
          {
            lang: "java",
            code: `boolean showFeature = client.boolVariation("example-flag-key", context, false);

if (showFeature) {
  // Application code to show the feature
}`,
          },
          {
            lang: "react",
            code: `import {
  useBoolVariation,
  useStringVariation,
  useNumberVariation,
  useJsonVariation,
} from '@launchdarkly/react-sdk';

const showNewFeature = useBoolVariation('show-new-feature', false);
const theme = useStringVariation('ui-theme', 'light');
const maxItems = useNumberVariation('max-items', 10);
const config = useJsonVariation('my-config', {});`,
          },
          {
            lang: "javascript",
            code: `const boolFlagValue = client.boolVariation('example-bool-flag-key', false);
const numberFlagValue = client.numberVariation('example-numeric-flag-key', 2);
const stringValue = client.stringVariation('example-string-flag-key', 'default');
const jsonValue = client.jsonVariation('example-json-flag-key', {});`,
          },
          {
            lang: "ios",
            code: `let showFeature = LDClient.get()!.boolVariation(forKey: "example-flag-key", defaultValue: false)`,
          },
          {
            lang: "android",
            code: `val showFeature: Boolean = client.boolVariation("example-flag-key", false)`,
          },
        ],
      },
      {
        id: "reasons",
        title: "Why a value was served",
        summary:
          "The detail variant returns the value with the reason: targeted, matched a rule, the default rule, the flag was off, a prerequisite failed, or an error. Useful for support tools and logs.",
        docs: `${DOCS}/sdk/features/evaluation-reasons`,
        inToggleWear: "The Live tab here, through a hook in lib/activity.ts",
        snippets: [
          {
            lang: "node",
            code: `const detail = await client.variationDetail('example-flag-key', context, false);

const value = detail.value;
const index = detail.variationIndex;
const reason = detail.reason; // { kind: 'RULE_MATCH', ruleIndex: 0, ruleId: '...' }`,
          },
          {
            lang: "python",
            code: `detail = client.variation_detail("example-flag-key", context, False)
value = detail.value
index = detail.variation_index
reason = detail.reason`,
          },
          {
            lang: "react",
            code: `import { useBoolVariationDetail } from '@launchdarkly/react-sdk';

const { value, variationIndex, reason } = useBoolVariationDetail('example-flag-key', false);`,
          },
          {
            lang: "javascript",
            code: `// Client-side SDKs need withReasons to receive them
const client = createClient('example-client-side-id', context, { withReasons: true });
client.start();

const detail = client.boolVariationDetail('example-flag-key', false);`,
          },
        ],
      },
      {
        id: "changes",
        title: "React to a flag change",
        summary:
          "Changes stream to every connected SDK as soon as they're saved. Subscribe when something has to happen at that moment rather than on the next evaluation, such as closing a connection pool.",
        docs: `${DOCS}/sdk/features/flag-changes`,
        inToggleWear: "lib/ldServer.ts, which posts the CHANGE lines in the Live tab",
        snippets: [
          {
            lang: "node",
            code: `client.on('update', ({ key }) => {
  console.log('a flag was changed: ' + key);
});

client.on('update:example-flag-key', () => {
  console.log('the example-flag-key flag was changed');
});`,
          },
          {
            lang: "python",
            code: `def flag_change_listener(flag_change):
    print(f"{flag_change.key} has changed")

listener = ldclient.get().flag_tracker.add_listener(flag_change_listener)`,
          },
          {
            lang: "javascript",
            code: `client.on('change', (context, changedKeys) => {
  changedKeys.forEach((flagKey) => {
    const flagValue = client.variation(flagKey, false);
  });
});`,
          },
        ],
      },
      {
        id: "hooks",
        title: "Hooks",
        summary:
          "Run your own code before or after every evaluation, for logging, metrics or tracing, without wrapping each call. LaunchDarkly's OpenTelemetry support is built as a hook.",
        docs: `${DOCS}/sdk/features/hooks`,
        inToggleWear: "lib/activity.ts (activityHook)",
        snippets: [
          {
            lang: "node",
            code: `import { init, integrations } from '@launchdarkly/node-server-sdk';

class ExampleHook implements integrations.Hook {
  getMetadata() {
    return { name: 'Example hook' };
  }

  afterEvaluation(hookContext, data, detail) {
    console.log(hookContext.flagKey, detail.value, detail.reason);
    return data;
  }
}

const client = init('YOUR_SDK_KEY', { hooks: [new ExampleHook()] });`,
          },
          {
            lang: "python",
            code: `from ldclient import Config
from ldclient.hook import Hook, Metadata

class ExampleHook(Hook):
    @property
    def metadata(self) -> Metadata:
        return Metadata(name="example-hook")

    def after_evaluation(self, series_context, data, detail):
        print(series_context.key, detail.value, detail.reason)
        return data

ldclient.set_config(Config("YOUR_SDK_KEY", hooks=[ExampleHook()]))`,
          },
        ],
      },
    ],
  },
  {
    id: "releases",
    title: "Releases",
    summary: "Shipping safely: kill switches, guarded rollouts, triggers, migrations and changing flags from code.",
    examples: [
      {
        id: "kill-switch",
        title: "A kill switch",
        summary:
          "Put the new code path behind a flag, with the proven path as the fallback. Turning the flag off is the rollback: no redeploy, and it streams to every server as soon as it's saved.",
        docs: `${DOCS}/home/flags/target`,
        inToggleWear: "12 New Payment Processor and the payment outage in the account menu",
        snippets: [
          {
            lang: "node",
            code: `const useNewProcessor = await client.boolVariation('new-payment-processor', context, false);

const charge = useNewProcessor
  ? await newProcessor.charge(order)
  : await legacyProcessor.charge(order);`,
          },
          {
            lang: "python",
            code: `use_new_processor = client.variation("new-payment-processor", context, False)

charge = (new_processor if use_new_processor else legacy_processor).charge(order)`,
          },
          {
            lang: "react",
            code: `const showNewCheckout = useBoolVariation('new-checkout', false);

return showNewCheckout ? <NewCheckout /> : <Checkout />;`,
          },
        ],
      },
      {
        id: "guarded",
        title: "What a guarded rollout needs from your code",
        summary:
          "A guarded rollout raises traffic in steps and rolls back by itself if a metric regresses. The metrics come from events your code sends, or from the Observability plugin's errors and latency, so the code only has to report what happened.",
        docs: `${DOCS}/home/releases/guarded-rollouts`,
        inToggleWear: "The guarded release scenarios in the demo data generator",
        snippets: [
          {
            lang: "node",
            code: `const started = Date.now();
try {
  await checkout(cart);
  client.track('checkout-completed', context);
} catch (err) {
  client.track('checkout-error', context);
  throw err;
} finally {
  // A numeric metric: the fourth argument is the value
  client.track('checkout-latency', context, undefined, Date.now() - started);
}`,
          },
          {
            lang: "python",
            code: `started = time.monotonic()
try:
    checkout(cart)
    client.track("checkout-completed", context)
except Exception:
    client.track("checkout-error", context)
    raise
finally:
    client.track("checkout-latency", context, metric_value=(time.monotonic() - started) * 1000)`,
          },
        ],
      },
      {
        id: "triggers",
        title: "Flag triggers",
        summary:
          "A trigger is a secret URL that turns a flag on or off when something POSTs to it, so a monitoring alert can flip the kill switch before anyone is paged. Copy the URL when you create it; LaunchDarkly hides it afterwards. Adaptive triggers, which watch a metric themselves, need no code at all; flag 14 and Smart Search use them.",
        docs: `${DOCS}/home/releases/triggers`,
        snippets: [
          {
            lang: "shell",
            code: `# The trigger URL is a credential: keep it in a secret store, never in code
curl -X POST "$LAUNCHDARKLY_TRIGGER_URL"`,
          },
        ],
      },
      {
        id: "rest-api",
        title: "Change a flag from code",
        summary:
          "The REST API takes semantic patch instructions, the same changes as the UI's buttons, for pipelines and scripts. Pin the API version so a new one can't change the response under you.",
        docs: `${DOCS}/api/feature-flags/update-feature-flag`,
        snippets: [
          {
            lang: "shell",
            code: `curl -X PATCH "https://app.launchdarkly.com/api/v2/flags/example-project/example-flag-key" \\
  -H "Authorization: $LAUNCHDARKLY_ACCESS_TOKEN" \\
  -H "LD-API-Version: 20240415" \\
  -H "Content-Type: application/json; domain-model=launchdarkly.semanticpatch" \\
  -d '{
    "environmentKey": "production",
    "comment": "Launching the new checkout",
    "instructions": [{ "kind": "turnFlagOn" }]
  }'`,
          },
        ],
      },
      {
        id: "migrations",
        title: "Migrations",
        summary:
          "A migration flag moves reads and writes from an old system to a new one in stages (off, dual write, shadow, live, rampdown, complete). The SDK runs both sides as the stage says and reports consistency, errors and latency.",
        docs: `${DOCS}/sdk/features/migrations`,
        snippets: [
          {
            lang: "node",
            code: `import {
  LDMigrationOptions,
  LDMigrationStage,
  LDMigrationSuccess,
  LDConcurrentExecution,
  createMigration,
} from '@launchdarkly/node-server-sdk';

const options: LDMigrationOptions = {
  readOld: async (key) => LDMigrationSuccess(await oldDb.get(key)),
  readNew: async (key) => LDMigrationSuccess(await newDb.get(key)),
  writeOld: async (params) => LDMigrationSuccess(await oldDb.put(params)),
  writeNew: async (params) => LDMigrationSuccess(await newDb.put(params)),
  check: (oldValue, newValue) => oldValue === newValue,
  execution: new LDConcurrentExecution(),
};

const migration = createMigration(client, options);

await migration.read('example-migration-flag-key', context, LDMigrationStage.Off);`,
          },
          {
            lang: "python",
            code: `from ldclient import Result, MigratorBuilder, ExecutionOrder
from ldclient.migrations import Stage

builder = MigratorBuilder(ldclient.get())
builder.read(lambda key: Result.success(old_db.get(key)),
             lambda key: Result.success(new_db.get(key)),
             lambda old, new: old == new)
builder.write(lambda item: Result.success(old_db.put(item)),
              lambda item: Result.success(new_db.put(item)))
builder.read_execution_order(ExecutionOrder.PARALLEL)

migrator = builder.build()
migrator.read("example-migration-flag-key", context, Stage.OFF)`,
          },
        ],
      },
    ],
  },
  {
    id: "experiments",
    title: "Experimentation",
    summary: "Sending the events that experiments and metrics measure.",
    examples: [
      {
        id: "track",
        title: "Track a conversion",
        summary:
          "An event key that matches a metric in LaunchDarkly. Evaluating the experiment's flag records who saw which variation; tracking records what they did next. That pairing is the whole integration.",
        docs: `${DOCS}/sdk/features/events`,
        inToggleWear: "lib/events.ts: add-to-cart, checkout and the other store events",
        snippets: [
          {
            lang: "node",
            code: `client.track('example-event-key', context);`,
          },
          {
            lang: "python",
            code: `ldclient.get().track("example-event-key", context)`,
          },
          {
            lang: "go",
            code: `client.TrackEvent("example-event-key", context)`,
          },
          {
            lang: "java",
            code: `client.track("example-event-key", context);`,
          },
          {
            lang: "react",
            code: `import { useLDClient } from '@launchdarkly/react-sdk';

const ldClient = useLDClient();
ldClient.track('example-event-key');`,
          },
          {
            lang: "javascript",
            code: `client.track('example-event-key');`,
          },
        ],
      },
      {
        id: "numeric",
        title: "Track a value",
        summary:
          "For numeric metrics such as revenue, basket size or latency, send the number with the event. The metric decides whether higher or lower is better, and how values are averaged or summed.",
        docs: `${DOCS}/sdk/features/events`,
        inToggleWear: "Checkout sends the order total",
        snippets: [
          {
            lang: "node",
            code: `client.track('checkout-revenue', context, { currency: 'USD' }, 84.5);`,
          },
          {
            lang: "python",
            code: `client.track("checkout-revenue", context, data={"currency": "USD"}, metric_value=84.5)`,
          },
          {
            lang: "go",
            code: `client.TrackMetric("checkout-revenue", context, 84.5, ldvalue.Null())`,
          },
          {
            lang: "javascript",
            code: `client.track('checkout-revenue', { currency: 'USD' }, 84.5);`,
          },
        ],
      },
    ],
  },
  {
    id: "agentcontrol",
    title: "AgentControl",
    summary: "Models, prompts and agents served from LaunchDarkly, with their quality measured.",
    examples: [
      {
        id: "ai-call",
        title: "Call a model",
        summary:
          "The current AI SDKs fetch the config for the context, call the model it names and record tokens, duration and success. Hand the SDK the server client you already have, register a handler for the providers you use, and the config decides which one runs.",
        docs: `${DOCS}/sdk/ai/node-js`,
        status: "Open beta",
        inToggleWear: "lib/aiServer.ts (getAiClient and the judges' handler)",
        snippets: [
          {
            lang: "node",
            code: `// npm install @launchdarkly/ai-node @launchdarkly/ai-langchain-messages
import { initClient, config } from '@launchdarkly/ai-node';
import { createLangChainMessagesHandler } from '@launchdarkly/ai-langchain-messages';

// Once, with the app's own server SDK client. The SDK shares it, so
// never call its shutdown(): that would close the client the flags use.
await initClient(ldClient);

const result = await config({
  key: 'my-ai-config-flag',
  handler: createLangChainMessagesHandler(),
}).invoke(
  'What is feature flagging?',
  { kind: 'user', key: 'user-123' },
  { user_name: 'Ada' }, // fills {{user_name}}; {{ldContext.key}} is the context's key
);

console.log(result.response);`,
          },
          {
            lang: "python",
            code: `# pip install launchdarkly-server-sdk launchdarkly-ai-server launchdarkly-ai-openai-messages
from launchdarkly_ai_server import config, shutdown
from launchdarkly_ai_openai_messages import create_openai_messages_handler
from launchdarkly_ai_claude_messages import create_claude_messages_handler

result = await config(
    key="my-ai-config",
    handler=[create_openai_messages_handler(), create_claude_messages_handler()],
).invoke(
    "What is feature flagging?",
    {"kind": "user", "key": "user-123"},
    {"user_name": "Ada"},
)

print(result.response)

await shutdown()`,
          },
        ],
      },
      {
        id: "ai-graph",
        title: "Run an agent graph",
        summary:
          "An agent graph is a set of agent configs and the handoffs between them, edited in LaunchDarkly. graph().invoke() walks it for you. Or resolve it for the context and run each node in the order your code decides: the SDK records each node's run and each handoff, and the graph's totals and the path taken are events you send.",
        docs: `${DOCS}/sdk/ai/node-js`,
        status: "Open beta",
        inToggleWear: "The order review agents (pages/api/order-review/index.ts)",
        snippets: [
          {
            lang: "node",
            code: `import { randomUUID } from 'crypto';
import { resolveGraph, getClient } from '@launchdarkly/ai-node';

const graph = await resolveGraph('support-graph', { context, handlers });
if (!graph.enabled || !graph.root) return fallback(ticket);

// The graph-level events are yours to send, on the graph's own key
const data = { runId: randomUUID(), configKey: graph.key, graphKey: graph.key };
const track = (event, value, extra = {}) =>
  getClient().track(event, context, { ...data, ...extra }, value);

const started = Date.now();
const intake = graph.root;
track('$ld:ai:graph:node', 1, { nodeKey: intake.key, index: 0 });
const triage = await graph.runNode(intake, ticket);

// from: sends $ld:ai:graph:handoff_success, or handoff_failure if it throws
const [next] = graph.getChildNodes(intake.key);
track('$ld:ai:graph:node', 1, { nodeKey: next.key, index: 1 });
const reply = await graph.runNode(next, triage.response, { from: intake });

track('$ld:ai:graph:duration:total', Date.now() - started);
track('$ld:ai:graph:total_tokens', triage.usage.total + reply.usage.total);
track('$ld:ai:graph:invocation_success', 1); // or invocation_failure on a throw`,
          },
          {
            lang: "python",
            code: `from launchdarkly_ai_server import graph, shutdown
from launchdarkly_ai_claude_agents import create_claude_agents_handler

result = await graph(
    "support-graph",
    handlers=[create_claude_agents_handler()],
).invoke(
    "I was double charged",
    {"kind": "user", "key": "user-123"},
    {"account_tier": "pro"},
)

print(result["response"])
print(result["usage"])

await shutdown()`,
          },
        ],
      },
      {
        id: "ai-own-loop",
        title: "Call the model with your own code",
        summary:
          "When the app needs its own model loop, to force a first tool call, ask again or answer in a schema, wrap it in a handler. The SDK fetches the config, hands your function its model, messages and tools with the variables, and records what it returns. invoke() throws when the config is off, so check first if you want a fallback.",
        docs: `${DOCS}/sdk/ai/node-js`,
        status: "Open beta",
        inToggleWear: "Smart search, the swag assistant and the personal stylist (pages/api/smart-search.ts)",
        snippets: [
          {
            lang: "node",
            code: `import { config, createHandler, inspectConfig } from '@launchdarkly/ai-node';

// invoke() has no fallback argument, so check the config first
const { enabled, meta } = await inspectConfig('example-config-key', context);
if (!enabled) return fallbackAnswer(question);

const handler = createHandler(['*', 'messages'], async (config, input, toolHandlers, variables) => {
  // config.model, config.messages and config.tools are the served variation's.
  // Fill in the {{placeholders}} from variables, then run your own LangChain loop.
  const { text, usage } = await runMyLoop(config, input, toolHandlers, variables);
  return { output: text, usage: { input: usage.input, output: usage.output } };
});

const result = await config({ key: 'example-config-key', handler }).invoke(
  question,
  context,
  { exampleCustomVariable: 'exampleCustomValue' },
);`,
          },
        ],
      },
      {
        id: "ai-metrics",
        title: "Record AI metrics",
        summary:
          "invoke() records duration, tokens and success or error against the variation that was served, and a tool call each time the model uses a tool from the config. Those are the numbers on the config's Monitoring tab. A handler that returns counts as a success, so throw when the answer can't be used. Feedback comes later: keep the run's track data on the server and send it with the rating.",
        docs: `${DOCS}/sdk/features/ai-metrics`,
        status: "Open beta",
        inToggleWear: "lib/aiServer.ts and pages/api/swag-assistant/feedback.ts",
        snippets: [
          {
            lang: "node",
            code: `import { config, createHandler, getClient } from '@launchdarkly/ai-node';

const handler = createHandler(['*', 'messages'], async (config, input, toolHandlers) => {
  const answer = await runMyLoop(config, input, toolHandlers);
  // Returning records generation:success, throwing records generation:error
  if (!answer.text) throw new Error('The model returned an empty reply');
  return { output: answer.text, usage: { input: answer.input, output: answer.output } };
});

// Each call to a tool in config.tools sends $ld:ai:tool_call
const result = await config({ key: 'example-config-key', handler, toolHandlers: tools })
  .invoke(question, context);

// Keep the run's track data on the server, by reply id
replies.set(replyId, result.trackData);

// Later, when the shopper rates the reply (or :negative)
getClient().track('$ld:ai:feedback:user:positive', context, replies.get(replyId), 1);`,
          },
        ],
      },
      {
        id: "ai-judges",
        title: "Judges",
        summary:
          "A judge is a config whose model scores another model's reply, for accuracy, relevance or toxicity. Attach judges to a config variation in LaunchDarkly. invoke() runs them before it returns; with skipJudges it hands them back as tasks instead, to run after the reply has gone out, sending each score yourself.",
        docs: `${DOCS}/home/agentcontrol/judges`,
        status: "Open beta",
        inToggleWear: "lib/aiServer.ts (judge), the JUDGE lines in the Live tab",
        snippets: [
          {
            lang: "node",
            code: `import { config, getClient, runJudge } from '@launchdarkly/ai-node';
import { createLangChainMessagesHandler } from '@launchdarkly/ai-langchain-messages';

const result = await config({ key, handler, toolHandlers: tools, skipJudges: true })
  .invoke(input, context, variables);
res.json({ text: result.response }); // the shopper doesn't wait for the judges

// The judges attached to the variation that answered, already sampled
for (const task of result.judgeTasks ?? []) {
  // null when the judge's reply doesn't parse, throws when its model call fails
  runJudge(task, [createLangChainMessagesHandler()])
    .then((r) => {
      if (r && task.evaluationMetricKey) {
        getClient().track(task.evaluationMetricKey, context, r.trackData, r.score);
      }
    })
    .catch((err) => console.warn('The judge could not score the reply', err));
}`,
          },
        ],
      },
    ],
  },
  {
    id: "observability",
    title: "Observability",
    summary: "Errors, logs, traces and session replay, tied to the flags that were on at the time.",
    examples: [
      {
        id: "obs-server",
        title: "Add Observability to a server",
        summary:
          "A plugin on the server SDK. It collects errors, logs and traces, and connects them to the flag evaluations in each request, which is what lets a guarded rollout watch error rate and latency.",
        docs: `${DOCS}/sdk/observability/node-js`,
        inToggleWear: "lib/ldServer.ts",
        snippets: [
          {
            lang: "node",
            code: `// npm install @launchdarkly/observability-node
import { init } from '@launchdarkly/node-server-sdk';
import { Observability } from '@launchdarkly/observability-node';

const client = init('YOUR_SDK_KEY', {
  plugins: [
    new Observability({
      serviceName: 'example-service',
      // the deployed git SHA, so errors can be matched to a release
      serviceVersion: 'example-sha',
    }),
  ],
});`,
          },
          {
            lang: "python",
            code: `# pip install launchdarkly-observability
import ldclient
from ldclient.config import Config
from ldobserve import ObservabilityPlugin

ldclient.set_config(Config("YOUR_SDK_KEY", plugins=[ObservabilityPlugin()]))`,
          },
          {
            lang: "go",
            code: `client, _ := ld.MakeCustomClient("YOUR_SDK_KEY",
    ld.Config{
        Plugins: []ldplugins.Plugin{
            ldobserve.NewObservabilityPlugin(),
        },
    }, 5*time.Second)`,
          },
        ],
      },
      {
        id: "obs-browser",
        title: "Add Observability and session replay to a web app",
        summary:
          "Two plugins on the browser SDK: Observability for errors, logs and network traces, and session replay to watch what the visitor saw. Set privacySetting to strict to mask text and inputs.",
        docs: `${DOCS}/sdk/observability/react-web`,
        inToggleWear: "components/ui/LaunchDarklyProvider.tsx",
        snippets: [
          {
            lang: "react",
            code: `// npm install @launchdarkly/react-sdk @launchdarkly/observability @launchdarkly/session-replay
import { createLDReactProvider } from '@launchdarkly/react-sdk';
import Observability from '@launchdarkly/observability';
import SessionReplay from '@launchdarkly/session-replay';

const LDProvider = createLDReactProvider(
  'example-client-side-id',
  { kind: 'user', key: 'example-context-key' },
  {
    ldOptions: {
      plugins: [
        new Observability({
          tracingOrigins: true, // connect browser requests to backend traces
          networkRecording: { enabled: true, recordHeadersAndBody: true },
        }),
        new SessionReplay({ privacySetting: 'strict' }),
      ],
    },
  },
);`,
          },
          {
            lang: "javascript",
            code: `import { createClient } from '@launchdarkly/js-client-sdk';
import Observability from '@launchdarkly/observability';
import SessionReplay from '@launchdarkly/session-replay';

const client = createClient('example-client-side-id', context, {
  plugins: [new Observability(), new SessionReplay({ privacySetting: 'strict' })],
});
client.start();`,
          },
        ],
      },
      {
        id: "obs-record",
        title: "Record errors, logs and spans",
        summary:
          "Uncaught errors are collected for you. Record handled ones yourself, with the attributes that will help whoever investigates, and wrap important work in a span so it shows in the trace.",
        docs: `${DOCS}/sdk/observability/node-js`,
        inToggleWear: "pages/api/personal-stylist/index.ts and pages/checkout.tsx",
        snippets: [
          {
            lang: "node",
            code: `import { LDObserve } from '@launchdarkly/observability-node';

await LDObserve.runWithHeaders('checkout.charge', req.headers, async (span) => {
  const { secureSessionId, requestId } = LDObserve.parseHeaders(req.headers);
  try {
    await charge(order);
  } catch (err) {
    LDObserve.recordError(err, secureSessionId, requestId, { 'order.id': order.id });
    throw err;
  }
  LDObserve.recordLog('Charge succeeded', 'info', secureSessionId, requestId);
});`,
          },
          {
            lang: "react",
            code: `import { LDObserve } from '@launchdarkly/observability';

try {
  await submitOrder();
} catch (error) {
  LDObserve.recordError(error, 'Order submit failed', { orderRef: ref });
}`,
          },
        ],
      },
      {
        id: "otel",
        title: "OpenTelemetry",
        summary:
          "Already on OpenTelemetry? The tracing hook adds every flag evaluation to the active span, so your existing tracing tool shows which flags were on in each request.",
        docs: `${DOCS}/sdk/features/opentelemetry-server-side`,
        snippets: [
          {
            lang: "node",
            code: `// npm install @launchdarkly/node-server-sdk-otel
import { init } from '@launchdarkly/node-server-sdk';
import { TracingHook } from '@launchdarkly/node-server-sdk-otel';

const client = init('YOUR_SDK_KEY', { hooks: [new TracingHook()] });`,
          },
          {
            lang: "python",
            code: `# pip install launchdarkly-server-sdk-otel
from ldclient import Config
from ldotel.tracing import Hook

ldclient.set_config(Config("YOUR_SDK_KEY", hooks=[Hook()]))`,
          },
        ],
      },
    ],
  },
  {
    id: "infrastructure",
    title: "Infrastructure",
    summary: "Relay Proxy, persistent stores, the edge, bootstrapping and offline use.",
    examples: [
      {
        id: "relay",
        title: "Relay Proxy",
        summary:
          "A small service you run inside your network. SDKs connect to it instead of LaunchDarkly, so thousands of servers share one connection out, and they keep getting flags if the outside connection drops.",
        docs: `${DOCS}/sdk/features/relay-proxy-configuration/proxy-mode`,
        snippets: [
          {
            lang: "node",
            code: `const client = init('YOUR_SDK_KEY', {
  streamUri: 'https://your-relay-proxy.com:8030',
  baseUri: 'https://your-relay-proxy.com:8030',
  eventsUri: 'https://your-relay-proxy.com:8030',
});`,
          },
          {
            lang: "python",
            code: `config = Config(sdk_key="YOUR_SDK_KEY",
  stream_uri="https://your-relay-proxy.com:8030",
  base_uri="https://your-relay-proxy.com:8030",
  events_uri="https://your-relay-proxy.com:8030")`,
          },
          {
            lang: "javascript",
            code: `const client = createClient('example-client-side-id', context, {
  streamUri: 'https://your-relay-proxy.com:8030',
  baseUri: 'https://your-relay-proxy.com:8030',
  eventsUri: 'https://your-relay-proxy.com:8030',
});`,
          },
        ],
      },
      {
        id: "store",
        title: "Persistent stores and daemon mode",
        summary:
          "SDKs can keep flag data in Redis, DynamoDB or Consul, so a new process starts with flags even before it connects. In daemon mode the Relay Proxy fills the store and SDKs only read it.",
        docs: `${DOCS}/sdk/features/storing-data`,
        snippets: [
          {
            lang: "node",
            code: `// npm install @launchdarkly/node-server-sdk-redis
import { init } from '@launchdarkly/node-server-sdk';
import { RedisFeatureStore } from '@launchdarkly/node-server-sdk-redis';

const client = init('YOUR_SDK_KEY', {
  featureStore: RedisFeatureStore({ redisOpts: { host: 'redis-host', port: 6379 } }),
  useLdd: true, // daemon mode: read from the store, don't connect to LaunchDarkly
});`,
          },
          {
            lang: "python",
            code: `from ldclient.config import Config
from ldclient.integrations import Redis

store = Redis.new_feature_store(url="redis://redis-host:6379")
ldclient.set_config(Config("YOUR_SDK_KEY", feature_store=store, use_ldd=True))`,
          },
        ],
      },
      {
        id: "edge",
        title: "Edge SDKs",
        summary:
          "For code at the CDN edge. The SDK reads flags from the platform's own key-value store, which LaunchDarkly keeps up to date, so an evaluation needs no call back to LaunchDarkly.",
        docs: `${DOCS}/sdk/edge/vercel`,
        snippets: [
          {
            lang: "javascript",
            code: `// Vercel: npm i @launchdarkly/vercel-server-sdk @vercel/edge-config
import { init } from '@launchdarkly/vercel-server-sdk';
import { createClient } from '@vercel/edge-config';

const edgeConfigClient = createClient(process.env.EDGE_CONFIG);
const ldClient = init('example-client-side-id', edgeConfigClient);

await ldClient.waitForInitialization();
const showBanner = await ldClient.boolVariation('example-flag-key', context, false);`,
          },
        ],
      },
      {
        id: "bootstrap",
        title: "Bootstrapping",
        summary:
          "Render the first frame with the right flags. The server evaluates them and puts them in the page, and the browser SDK starts with those instead of waiting on a request, so nothing flickers.",
        docs: `${DOCS}/sdk/features/bootstrapping`,
        inToggleWear: "components/ui/LaunchDarklyProvider.tsx (bootstraps from localStorage)",
        snippets: [
          {
            lang: "node",
            code: `// Server: evaluate the browser's flags and put them in the page
const state = await client.allFlagsState(context, { clientSideOnly: true });
const bootstrapData = JSON.stringify(state.toJSON());`,
          },
          {
            lang: "javascript",
            code: `import { createClient } from '@launchdarkly/js-client-sdk';

const client = createClient('example-client-side-id', context);

// bootstrapData is the server's allFlagsState output
client.start({ bootstrap: JSON.parse(bootstrapData) });`,
          },
        ],
      },
      {
        id: "test-data",
        title: "Flags in unit tests",
        summary:
          "A test data source replaces the connection to LaunchDarkly, and the test sets each flag's value directly, so tests run fast, offline and the same every time.",
        docs: `${DOCS}/sdk/features/test-data-sources`,
        snippets: [
          {
            lang: "node",
            code: `import { init } from '@launchdarkly/node-server-sdk';
import { TestData } from '@launchdarkly/node-server-sdk/integrations';

const td = new TestData();
td.update(td.flag('example-flag-key').booleanFlag().variationForAll(true));

const client = init('YOUR_SDK_KEY', { updateProcessor: td.getFactory() });

// change it mid-test
td.update(td.flag('example-flag-key').booleanFlag().variationForAll(false));`,
          },
          {
            lang: "python",
            code: `from ldclient import LDClient, Config
from ldclient.integrations.test_data import TestData

td = TestData.data_source()
td.update(td.flag("example-flag-key").variation_for_all(True))

client = LDClient(config=Config("YOUR_SDK_KEY", update_processor_class=td))`,
          },
        ],
      },
    ],
  },
  {
    id: "workflow",
    title: "Developer workflow",
    summary: "Tools around the SDKs: code references, the CLI, Terraform, the MCP server and the toolbar.",
    examples: [
      {
        id: "code-refs",
        title: "Code references",
        summary:
          "A CI step that finds where each flag key is used in the repository and shows it on the flag in LaunchDarkly, so you know what to delete when a flag is retired.",
        docs: `${DOCS}/home/flags/code-references/github-actions`,
        inToggleWear: ".github/workflows/ld-add-code-references.yaml",
        snippets: [
          {
            lang: "yaml",
            code: `name: Find LaunchDarkly flag code references
on: push

jobs:
  launchDarklyCodeReferences:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 11 # lets it find flags whose last reference was removed
      - uses: launchdarkly/find-code-references@v2
        with:
          accessToken: \${{ secrets.LD_ACCESS_TOKEN }}
          projKey: example-project`,
          },
        ],
      },
      {
        id: "cli",
        title: "LaunchDarkly CLI",
        summary: "ldcli covers the REST API from a terminal: flags, environments, experiments, and uploading sourcemaps for Observability.",
        docs: `${DOCS}/home/getting-started/ldcli-commands`,
        snippets: [
          {
            lang: "shell",
            code: `ldcli login

ldcli flags create --project default -d '{"name": "Example flag", "key": "example-flag"}'

ldcli flags list --project default --output json

# readable stack traces in Observability
ldcli sourcemaps upload --app-version "$GIT_SHA" --path ./build --project default`,
          },
        ],
      },
      {
        id: "terraform",
        title: "Terraform",
        summary:
          "Projects, environments, flags and their targeting as code, reviewed and applied like the rest of your infrastructure.",
        docs: `${DOCS}/guides/infrastructure/terraform`,
        snippets: [
          {
            lang: "hcl",
            code: `resource "launchdarkly_feature_flag" "building_materials" {
  project_key = launchdarkly_project.example.key
  key         = "building-materials"
  name        = "Building materials"
  description = "this is a multivariate flag with string variations."

  variation_type = "string"
  variations = [
    { value = "straw", name = "Straw" },
    { value = "sticks", name = "Sticks" },
    { value = "bricks", name = "Bricks" },
  ]

  defaults = {
    on_variation  = 2
    off_variation = 0
  }

  tags = ["managed-by-terraform"]
}`,
          },
        ],
      },
      {
        id: "mcp",
        title: "MCP server",
        summary:
          "Connects an AI coding assistant (Cursor, Claude Code, VS Code) to LaunchDarkly, to create flags, change targeting and clean up stale flags from the editor. The hosted server signs in with OAuth, so there's no key to paste.",
        docs: `${DOCS}/home/getting-started/mcp-hosted`,
        snippets: [
          {
            lang: "json",
            code: `{
  "mcpServers": {
    "launchdarkly": {
      "url": "https://mcp.launchdarkly.com/mcp/launchdarkly",
      "headers": {}
    }
  }
}`,
          },
        ],
      },
      {
        id: "toolbar",
        title: "Developer toolbar",
        summary:
          "A panel inside your own app for overriding flags in this browser and watching the events it sends, without touching anyone else's targeting.",
        docs: `${DOCS}/home/getting-started/dev-toolbar`,
        inToggleWear: "components/ui/DeveloperToolbar.tsx; switch it on from Demo tools",
        snippets: [
          {
            lang: "react",
            code: `// npm install @launchdarkly/toolbar
import { useLaunchDarklyToolbar } from '@launchdarkly/toolbar/react';
import { FlagOverridePlugin, EventInterceptionPlugin } from '@launchdarkly/toolbar/plugins';

// Also pass both plugins to the LaunchDarkly SDK's plugins option
export const flagOverridePlugin = new FlagOverridePlugin();
export const eventInterceptionPlugin = new EventInterceptionPlugin();

function App() {
  useLaunchDarklyToolbar({
    flagOverridePlugin,
    eventInterceptionPlugin,
    position: 'bottom-right',
    enabled: process.env.NODE_ENV === 'development',
  });
  // ...
}`,
          },
        ],
      },
    ],
  },
];
