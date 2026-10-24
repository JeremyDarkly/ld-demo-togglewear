"""DemoBuilder — builds a ToggleWear demo project in LaunchDarkly.

The resources themselves (metrics, metric groups, flags, segments, context
kinds and experiments) are declared in the tables in demo_resources.py, and
the loops here create them.  To add or change one, edit the table.

A resource that does not fit its table's shape can name a method here with
{"custom": "<method name>"} and be built by hand instead.
"""

import LDPlatform
import json
import os
import re
from dotenv import load_dotenv
import subprocess
import time
import sys
import uuid
# Load environment variables from .env file
load_dotenv()


# Resource definitions live in demo_resources.py — edit the tables there
# to add or change demo resources.
from demo_resources import (
    METRICS,
    METRIC_GROUPS,
    FLAGS,
    SEGMENTS,
    CONTEXT_KINDS,
    EXPERIMENTS,
    PROMPT_SNIPPETS,
    AI_TOOLS,
    AI_CONFIGS,
    AGENT_CONFIGS,
    AGENT_GRAPHS,
    DATASETS,
    PLAYGROUNDS,
    AGENT_OPTIMIZATIONS,
)


class DemoBuilder:
    project_created = False
    flags_created = False
    segments_created = False
    metrics_created = False
    metric_groups_created = False
    contexts_created = False
    experiment_created = False
    ai_config_created = False
    email = None
    client_id = ''
    sdk_key = ''
    phase_ids = {}
    def __init__(self, api_key, email, api_key_user, project_key, project_name):
        self.api_key = api_key
        self.email = email
        self.api_key_user = api_key_user
        self.project_key = project_key
        self.project_name = project_name
        self.ldproject = LDPlatform.LDPlatform(api_key, api_key_user, email)
        self.ldproject.project_key = project_key

    # Only the generic, table-driven steps, while ToggleWear's resources are
    # rebuilt one capability at a time.  ToggleBank's own steps — its AI
    # Configs, holdout, layer, maintainers, targeting and template-environment
    # copies — named its flags directly and were deleted rather than carried;
    # they are in git history and in ld-core-demo.  A ToggleWear equivalent
    # arrives as a table entry, or a step here, with the capability needing it.
    def build(self):
        self.create_project()
        # Declared up front rather than left to appear when the SDK first sends
        # one, so device and location are already marked available for
        # experiments before any segment, flag or experiment refers to them.
        self.create_contexts()
        self.create_segments()
        self.create_metrics()
        self.create_metric_groups()
        self.create_flags()
        # After the segments, which the Swag Assistant's member rule matches.
        self.create_ai_configs()
        # After the agents, since a graph's nodes have to exist.
        self.create_agent_graphs()
        self.create_playgrounds()
        self.create_agent_optimizations()
        # After the flags, which each experiment takes over, and before the
        # results, so the generated traffic lands in a running iteration.
        self.create_and_run_experiments()
        self.generate_results()

    # Synthetic traffic for the guarded releases and the experiments, in a
    # subprocess so the SDK client it opens is torn down with it.
    #
    # Has to run after create_flags and create_ai_configs: the guarded release
    # generators poll for their rollout and give up if it never turns up.
    # Blocks while they work, which is around ten minutes — flag 07 is rolled
    # back after six to eight, and flag 06 and the Personal Stylist take the
    # full ten to walk their rollouts up to 100%.
    def generate_results(self):
        print("Generating demo results — allow around 10 minutes", end="...\n")
        env = os.environ.copy()
        env["LD_PROJECT_KEY"] = self.project_key
        env["LD_API_KEY"] = self.api_key
        env["LD_SDK_KEY"] = self.sdk_key
        env["LD_CLIENT_KEY"] = self.client_id

        proc = subprocess.Popen(
            # sys.executable rather than "python3": the observability plugin
            # lives in whichever interpreter installed requirements.txt, and a
            # bare "python3" would resolve to the system one and silently drop
            # the telemetry.
            [sys.executable, os.path.join(os.path.dirname(__file__), "LDGeneratorsRunner.py")],
            env=env,
        )
        proc.wait()
        print("Done")

    def create_project(self):
        if self.ldproject.project_exists(self.project_key):
            self.ldproject.delete_project()
        print("Creating project", end="...")
        self.ldproject.create_project(self.project_key, self.project_name)
        print("Done")
        self.client_id = self.ldproject.client_id
        self.sdk_key = self.ldproject.sdk_key
        self.project_created = True
        
        print("Creating template environment", end="...")
        self.ldproject.create_environment("template-env", "Template")
        print("Done")
        
        env_file = os.getenv('GITHUB_ENV')
        if env_file:
            # The repo is public, and so are its Actions logs, which print a
            # step's env. Masked before the keys reach GITHUB_ENV, so every
            # later step shows *** in their place. GitHub only reads a
            # command at the start of a line, hence the leading newline.
            for key in (self.sdk_key, self.client_id):
                print(f"\n::add-mask::{key}", flush=True)
            try:
                with open(env_file, "a") as f:
                    f.write(f"LD_SDK_KEY={self.sdk_key}\n")
                    f.write(f"LD_CLIENT_KEY={self.client_id}\n")
            except IOError as e:
                print(f"Unable to write to environment file: {e}")
        else:
            print("GITHUB_ENV not set")

    # Create all the metrics (definitions live in the METRICS table above)
    def create_metrics(self):
        print("Creating metrics...")
        for spec in METRICS:
            self.ldproject.create_metric(**spec)
        print("Done")
        self.metrics_created = True

    # Create all the metric groups (definitions live in the METRIC_GROUPS table above)
    def create_metric_groups(self):
        if not self.metrics_created:
            print("Error: Metrics not created")
            return
        print("Creating metric groups...")
        for spec in METRIC_GROUPS:
            self.ldproject.create_metric_group(**spec)
        print("Done")
        self.metric_groups_created = True

    # Create all the flags (definitions live in the FLAGS table above)
    def create_flags(self):
        if not self.project_created:
            print("Error: Project not created")
            return
        print("Creating flags...")
        for spec in FLAGS:
            if "custom" in spec:
                getattr(self, spec["custom"])()
                continue
            self.ldproject.create_flag(**spec["flag"])
            # Follow-up actions (guarded/progressive rollouts, metric attachments)
            for method, args, kwargs in spec.get("post", []):
                getattr(self.ldproject, method)(*args, **kwargs)
        print("Done")
        self.flags_created = True

    # Create all the segments (definitions live in the SEGMENTS table above)
    def create_segments(self):
        print("Creating segments...")
        for spec in SEGMENTS:
            if "custom" in spec:
                getattr(self, spec["custom"])()
                continue
            for env in spec["environments"]:
                self.ldproject.create_segment(
                    spec["key"], spec["name"], env, spec["description"]
                )
                for context_kind, attribute, op, values in spec["rules"]:
                    self.ldproject.add_segment_rule(
                        spec["key"], env, context_kind, attribute, op, values
                    )
        print("Done")
        self.segments_created = True

    # Create all the context kinds (definitions live in the CONTEXT_KINDS table above)
    def create_contexts(self):
        print("Creating contexts...")
        for context_key, for_experiment in CONTEXT_KINDS:
            self.ldproject.create_context(context_key, for_experiment=for_experiment)
        print("Done")
        self.contexts_created = True

    # Create the prompt snippets, tools and AI Configs (definitions live in
    # the PROMPT_SNIPPETS, AI_TOOLS and AI_CONFIGS tables above). The models
    # are LaunchDarkly's built-in ones, so there are none to create.
    def create_ai_configs(self):
        if not self.segments_created:
            print("Error: Segments not created")
            return
        # First, because a variation that names a snippet cannot be saved
        # before the snippet exists.
        print("Creating prompt snippets...")
        for spec in PROMPT_SNIPPETS:
            self.ldproject.create_snippet(**spec)
        print("Done")

        print("Creating AI tools...")
        # A variation attaches a tool at a version, which is whatever the
        # create call hands back.
        tool_versions = {}
        for spec in AI_TOOLS:
            response = self.ldproject.create_ai_tool(**spec)
            try:
                tool_versions[spec["tool_key"]] = json.loads(response.text).get("version", 1)
            except (json.JSONDecodeError, AttributeError):
                tool_versions[spec["tool_key"]] = 1
        print("Done")

        print("Creating AI Configs...")
        for spec in AI_CONFIGS + AGENT_CONFIGS:
            key = spec["config"]["config_key"]
            env = spec["environment"]
            self.ldproject.create_ai_config(**spec["config"])
            for variation in spec["variations"]:
                self.ldproject.create_ai_config_versions(key, **variation)
                variation_key = variation["ai_config_version_key"]
                if spec.get("tools"):
                    self.ldproject.patch_variation_tools(
                        key,
                        variation_key,
                        [{"key": t, "version": tool_versions.get(t, 1)} for t in spec["tools"]],
                    )
                if spec.get("judges"):
                    self.ldproject.attach_judges_to_variation(key, variation_key, spec["judges"])
            for variation_key, clauses in spec.get("rules", []):
                self.ldproject.update_ai_config_targeting_add_rule(
                    key, env, self.ldproject.get_ai_config_variation_id(key, variation_key), clauses
                )
            self.ldproject.update_ai_config_targeting(
                key, env, self.ldproject.get_ai_config_variation_id(key, spec["fallthrough"])
            )
            # An AI Config is a flag underneath, and the flag toggle is what
            # switches it on: LDPlatform.toggle_ai_config sends an instruction
            # the AI Config targeting API no longer accepts.
            self.ldproject.toggle_flag(key, "on", env)
            # AI Configs are created without the project's default client-side
            # availability, so the browser cannot see one until it is asked for.
            if spec.get("client_side"):
                self.ldproject.update_flag_client_side_availability(key)
            judges = len(spec.get("judges", []))
            print(f"  AI Config created: {spec['config']['config_name']}"
                  + (f" ({judges} judge{'s' if judges > 1 else ''} on each variation)" if judges else ""))
            if spec.get("guarded_rollout"):
                self.start_ai_config_guarded_rollout(key, env, spec["guarded_rollout"])
            # Last, once the config is on: the trigger switches the default
            # rule, which has to exist and be serving for that to mean anything.
            if spec.get("adaptive_trigger"):
                trigger = dict(spec["adaptive_trigger"])
                self.ldproject.create_adaptive_trigger(
                    key, env, trigger.pop("serve"), resource_kind="ai-config", **trigger
                )
        print("Done")
        self.ai_config_created = True

    def create_agent_graphs(self):
        if not self.ai_config_created:
            print("Error: AI Configs not created")
            return
        print("Creating agent graphs...")
        for spec in AGENT_GRAPHS:
            self.ldproject.create_agent_graph(
                spec["graph_key"],
                spec["graph_name"],
                spec["description"],
                [{"key": key, "sourceConfig": source, "targetConfig": target}
                 for key, source, target in spec["edges"]],
                root_config_key=spec["root"],
            )
            print(f"  Agent graph created: {spec['graph_name']}")
        print("Done")

    # Uploads the datasets, then makes each playground: an evaluation per
    # variant, the playground holding them, and a run of each over its
    # dataset, which LaunchDarkly finishes in the background.
    def create_playgrounds(self):
        if not self.ai_config_created:
            print("Error: AI Configs not created")
            return
        print("Uploading datasets...")
        datasets_dir = os.path.join(os.path.dirname(__file__), "datasets")
        dataset_ids = {}
        for spec in DATASETS:
            with open(os.path.join(datasets_dir, spec["file"]), encoding="utf-8") as f:
                dataset_ids[spec["name"]] = self.ldproject.upload_dataset(spec["name"], f.read(), spec["file"])
        print("Done")

        print("Creating playgrounds...")
        snippets = {s["key"]: s["text"] for s in PROMPT_SNIPPETS}
        for spec in PLAYGROUNDS:
            dataset_id = dataset_ids.get(spec["dataset"])
            evaluation_ids = []
            for variant in spec["variants"]:
                text = " ".join(m["content"] for m in variant["messages"])
                evaluation_ids.append(self.ldproject.create_evaluation(
                    name=variant["name"],
                    generation_provider=variant["provider"],
                    generation_model=variant["model"],
                    messages=variant["messages"],
                    # Accuracy rather than likeness, which marks a right answer
                    # down for being longer or shorter than the expected one.
                    # Without the option, accuracy ignores the row's expected
                    # output and judges from the input alone.
                    criteria=[{"criterionType": "accuracy", "kind": "deepeval",
                               "options": {"expected_output": "{{expected_output}}"}}],
                    evaluation_provider="Anthropic",
                    evaluation_model="Anthropic.claude-sonnet-4-6",
                    variables={name: "" for name in re.findall(r"\{\{(\w+)\}\}", text)},
                    parameters=variant["parameters"],
                    prompt_snippets={key: snippets[key]
                                     for key in re.findall(r"\{\{snippet\.([\w-]+)#\d+\}\}", text)},
                ))
            if None in evaluation_ids:
                print(f"  Error: playground {spec['name']} not created")
                continue
            playground_id = self.ldproject.create_playground(spec["name"], evaluation_ids)
            if playground_id and dataset_id:
                for evaluation_id in evaluation_ids:
                    self.ldproject.start_evaluation_run(evaluation_id, playground_id, dataset_id)
            print(f"  Playground created: {spec['name']}")
        print("Done")

    # Each optimization's rows come from its dataset, and its finished run is
    # the real one run_optimization.py saved, replayed result by result.
    def create_agent_optimizations(self):
        if not self.ai_config_created:
            print("Error: AI Configs not created")
            return
        print("Creating agent optimizations...")
        here = os.path.dirname(__file__)
        for spec in AGENT_OPTIMIZATIONS:
            with open(os.path.join(here, "datasets", spec["dataset"]), encoding="utf-8") as f:
                rows = {r["metadata"]["scenario"]: r for r in map(json.loads, f)}
            samples = [rows[s] for s in spec["scenarios"]]
            created = self.ldproject.create_agent_optimization(
                key=spec["key"],
                ai_config_key=spec["ai_config_key"],
                max_attempts=spec["max_attempts"],
                judge_model=spec["judge_model"],
                model_choices=spec["model_choices"],
                acceptance_statements=spec["acceptance_statements"],
                judges=spec["judges"],
                user_input_options=[r["input"] for r in samples],
                ground_truth_responses=[r["expected_output"] for r in samples],
                variable_choices=[r.get("variables", {}) for r in samples],
                token_optimization=spec.get("token_optimization", False),
                auto_commit=False,
            )
            results_file = os.path.join(here, "optimizations", f"{spec['key']}.json")
            if not created or "version" not in created:
                continue
            if not os.path.exists(results_file):
                print(f"  Agent optimization created: {spec['key']}")
                continue
            with open(results_file, encoding="utf-8") as f:
                events = json.load(f)
            run_id, result_ids = str(uuid.uuid4()), {}
            for event in events:
                payload = event["payload"]
                # The optimizer's opening result has no user input, which
                # LaunchDarkly turns away, in the real run too.
                if event["op"] == "post" and not payload.get("userInput"):
                    continue
                if event["op"] == "post":
                    result_ids[event["ref"]] = self.ldproject.post_agent_optimization_result(
                        spec["key"], run_id, created["version"], payload["iteration"],
                        payload["instructions"], payload["userInput"], payload.get("parameters"))
                elif result_ids.get(event["ref"]):
                    self.ldproject.patch_agent_optimization_result(
                        spec["key"], result_ids[event["ref"]],
                        status=payload.get("status"),
                        activity=payload.get("activity"),
                        completion_response=payload.get("completionResponse"),
                        variation=payload.get("variation"),
                        scores=payload.get("scores"),
                        generation_tokens=payload.get("generationTokens"),
                        evaluation_tokens=payload.get("evaluationTokens"),
                        generation_latency=payload.get("generationLatency"),
                        evaluation_latencies=payload.get("evaluationLatencies"),
                    )
            print(f"  Agent optimization created: {spec['key']} (run replayed)")
        print("Done")

    # An AI Config's guarded rollout, started at build time for
    # results_generator.py to walk to 100%. Its metrics are the AI ones in the
    # METRICS table, which create_metrics has made by now; they are checked
    # for rather than assumed, so a missing one says which.
    def start_ai_config_guarded_rollout(self, key, env, rollout):
        missing = list(rollout["metrics"])
        for _ in range(12):
            missing = [m for m in missing if not self.ldproject.metric_exists(m)]
            if not missing:
                break
            time.sleep(5)
        if missing:
            print(f"    Error: no guarded rollout on {key}, metrics not found: {', '.join(missing)}")
            return
        res = self.ldproject.add_ai_agent_guarded_rollout(
            key,
            env,
            metrics=rollout["metrics"],
            rollback=True,
            control_key=rollout["control"],
            target_key=rollout["target"],
            stages=rollout["stages"],
        )
        if res is not None and res.status_code < 300:
            print(f"    Guarded rollout started: {rollout['control']} to {rollout['target']}")

    # Create and run all the experiments (definitions live in the EXPERIMENTS table above)
    def create_and_run_experiments(self):
        print("Creating experiments...")
        for spec in EXPERIMENTS:
            if "custom" in spec:
                getattr(self, spec["custom"])()
                continue
            self.run_experiment(spec)
        print("Done")

    def run_experiment(self, spec):
        if not getattr(self, spec["requires"]):
            print(f"  Error: prerequisite '{spec['requires']}' not met")
            return
        exp = spec["experiment"]
        print(f"  {exp['exp_name']}")
        if spec["toggle_flag"]:
            self.ldproject.toggle_flag(*spec["toggle_flag"])
        metrics = [self.ldproject.exp_metric(key, is_group) for key, is_group in spec["metrics"]]
        self.ldproject.create_experiment(metrics=metrics, **exp)
        if spec["start_iteration"]:
            self.ldproject.start_exp_iteration(exp["exp_key"], exp["exp_env"])
        self.experiment_created = True


if __name__ == "__main__":
    
    LD_API_KEY = os.getenv("LD_API_KEY")
    LD_API_KEY_USER = os.getenv("LD_API_KEY_USER")
    LD_PROJECT_KEY = os.getenv("LD_PROJECT_KEY")
    # DEMO_USER rather than DEMO_NAMESPACE: the namespace is <name>-togglewear,
    # which is neither a mailbox nor what the project should be called.
    email = os.getenv('DEMO_USER') + "@launchdarkly.com"
    LD_PROJECT_NAME = f"ToggleWear Demo - {os.getenv('DEMO_USER')}"

    demo = DemoBuilder(
        LD_API_KEY, email, LD_API_KEY_USER, LD_PROJECT_KEY, LD_PROJECT_NAME)
    
    demo.build()
