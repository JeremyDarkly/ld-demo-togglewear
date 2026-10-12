"""DemoBuilder — builds a ToggleWear demo project in LaunchDarkly.

The resources themselves (metrics, metric groups, flags, segments, context
kinds and experiments) are declared in the tables in demo_resources.py, and
the loops here create them.  To add or change one, edit the table.

A resource that does not fit its table's shape can name a method here with
{"custom": "<method name>"} and be built by hand instead.
"""

import LDPlatform
import os
from dotenv import load_dotenv
import subprocess
import sys
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
        # After the flags, which each experiment takes over, and before the
        # results, so the generated traffic lands in a running iteration.
        self.create_and_run_experiments()
        self.generate_results()

    # Synthetic traffic for the guarded releases and the experiments, in a
    # subprocess so the SDK client it opens is torn down with it.
    #
    # Has to run after create_flags: both generators poll for their flag's
    # rollout and give up if it never turns up.  Blocks while they work, which
    # is around ten minutes — flag 06 is rolled back after six to eight, and
    # flag 05 takes the full ten to walk its rollout up to 100%.
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
        
        env_file = os.getenv('GITHUB_ENV')
        if env_file:
            try:
                with open(env_file, "a") as f:
                    f.write(f"LD_SDK_KEY={self.sdk_key}\n")
                    f.write(f"LD_CLIENT_KEY={self.client_id}\n")
                    f.write(f"Projected_Created={self.project_created}\n")   
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

    # Create and run all the experiments (definitions live in the EXPERIMENTS table above)
    def create_and_run_experiments(self):
        for spec in EXPERIMENTS:
            if "custom" in spec:
                getattr(self, spec["custom"])()
                continue
            self.run_experiment(spec)

    def run_experiment(self, spec):
        if not getattr(self, spec["requires"]):
            print(f"Error: prerequisite '{spec['requires']}' not met")
            return
        exp = spec["experiment"]
        print("Creating experiment: ")
        if spec["toggle_flag"]:
            self.ldproject.toggle_flag(*spec["toggle_flag"])
        print(f" - {exp['exp_name']}")
        metrics = [self.ldproject.exp_metric(key, is_group) for key, is_group in spec["metrics"]]
        self.ldproject.create_experiment(metrics=metrics, **exp)
        if spec["start_iteration"]:
            self.ldproject.start_exp_iteration(exp["exp_key"], exp["exp_env"])
        print("Done creating experiment")
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
