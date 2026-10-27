"""check_build — confirms a ToggleWear project has everything DemoBuilder makes.

DemoBuilder prints an error and carries on when one resource fails, so a run
can finish green with, say, an AI Config missing. This reads the project back
and compares it with the tables in demo_resources.py, so anything added there
is checked too. It only reads.

Exits 1, listing what is missing, when anything is. The workflows run it as
their last step, after the store is online, so a gap never keeps a store
offline; the provisioning app reads that step failing as "your store is up,
but some of the project didn't build".

    python check_build.py [project-key]    # defaults to $LD_PROJECT_KEY
"""

import os
import sys

from dotenv import load_dotenv

import LDPlatform
from demo_resources import (
    AGENT_CONFIGS,
    AGENT_GRAPHS,
    AGENT_OPTIMIZATIONS,
    AI_CONFIGS,
    AI_TOOLS,
    CONTEXT_KINDS,
    DATASETS,
    EXPERIMENTS,
    FLAGS,
    METRIC_GROUPS,
    METRICS,
    PLAYGROUNDS,
    PROMPT_SNIPPETS,
    SEGMENTS,
)

load_dotenv()

BASE = "https://app.launchdarkly.com"
# The segments list refuses more than 50 a page.
PAGE = 50


class BuildCheck:
    def __init__(self, api_key, project_key):
        self.api_key = api_key
        self.project_key = project_key
        # For its retries on 429s, 5xxs and dropped connections.
        self.ld = LDPlatform.LDPlatform(api_key, None, None)
        self.missing = []

    def get(self, path, version="20240415"):
        res = self.ld.getrequest(
            "GET", BASE + path,
            headers={"Authorization": self.api_key, "LD-API-Version": version},
        )
        if not res.ok:
            return res.status_code, None
        return res.status_code, res.json()

    # Every item of a paged list, or None when a page could not be read.
    def listed(self, path, version="20240415", field="items"):
        items, offset = [], 0
        sep = "&" if "?" in path else "?"
        while True:
            status, body = self.get(f"{path}{sep}limit={PAGE}&offset={offset}", version)
            if body is None:
                self.missing.append(f"Couldn't read {path} (HTTP {status})")
                return None
            page = body.get(field) or []
            items += page
            if len(page) < PAGE:
                return items
            offset += PAGE

    # Records each expected key that `found` lacks, under its readable name.
    def expect(self, kind, expected, found):
        if found is None:
            return
        gaps = [name for key, name in expected if key not in found]
        self.missing += [f"{kind}: {name}" for name in gaps]
        print(f"{'OK  ' if not gaps else 'MISS'} {kind}: {len(expected) - len(gaps)} of {len(expected)}")

    def run(self):
        p = self.project_key
        status, project = self.get(f"/api/v2/projects/{p}")
        if project is None:
            self.missing.append(f"The LaunchDarkly project {p} (HTTP {status})")
            return self.missing

        self.check_flags(p)
        self.check_segments(p)

        status, body = self.get(f"/api/v2/projects/{p}/context-kinds")
        self.expect("Context kind", [(k, k) for k, _ in CONTEXT_KINDS],
                    None if body is None else {c["key"] for c in body.get("items", [])})

        metrics = self.listed(f"/api/v2/metrics/{p}")
        self.expect("Metric", [(m["metric_key"], m.get("metric_name") or m["metric_key"]) for m in METRICS],
                    None if metrics is None else {m["key"] for m in metrics})
        groups = self.listed(f"/api/v2/projects/{p}/metric-groups", "beta")
        self.expect("Metric group", [(g["group_key"], g.get("group_name") or g["group_key"]) for g in METRIC_GROUPS],
                    None if groups is None else {g["key"] for g in groups})

        self.check_experiments(p)
        self.check_ai(p)
        self.check_reset_key(p)
        return self.missing

    def check_flags(self, p):
        specs = [s for s in FLAGS if "flag" in s]
        flags = self.listed(f"/api/v2/flags/{p}?summary=1")
        self.expect("Flag", [(s["flag"]["flag_key"], s["flag"]["flag_name"]) for s in specs],
                    None if flags is None else {f["key"] for f in flags})

        for spec in specs:
            name = spec["flag"]["flag_name"]
            for method, args, _ in spec.get("post", []):
                if method == "create_trigger_alert":
                    flag_key, env = args[0], args[1]
                    status, body = self.get(f"/api/v2/flags/{p}/{flag_key}/triggers/{env}")
                    triggers = [] if body is None else body.get("items", [])
                    # Making the alert pings its webhook once, so a trigger
                    # nothing has called is one whose alert was never made.
                    if not any(t.get("enabled") and (t.get("_triggerCount") or 0) >= 1 for t in triggers):
                        self.missing.append(f"Trigger and alert: {name}")
                    else:
                        print(f"OK   Trigger and alert: {name}")
                elif method == "create_adaptive_trigger":
                    self.check_adaptive_trigger(p, "flag", args[0], args[1], name)

    # An adaptive trigger's alert is made first and deleted if the trigger
    # can't be, so finding the trigger means both are there.
    def check_adaptive_trigger(self, p, kind, key, env, name):
        status, body = self.get(
            f"/api/v2/projects/{p}/environments/{env}/adaptive-triggers?resourceKind={kind}&resourceKey={key}")
        if body is None or not body.get("items"):
            self.missing.append(f"Adaptive trigger: {name}")
        else:
            print(f"OK   Adaptive trigger: {name}")

    def check_segments(self, p):
        for env in sorted({e for s in SEGMENTS for e in s["environments"]}):
            segments = self.listed(f"/api/v2/segments/{p}/{env}")
            self.expect(f"Segment in {env}", [(s["key"], s["name"]) for s in SEGMENTS if env in s["environments"]],
                        None if segments is None else {s["key"] for s in segments})

    def check_experiments(self, p):
        specs = [s for s in EXPERIMENTS if "experiment" in s]
        for env in sorted({s["experiment"]["exp_env"] for s in specs}):
            experiments = self.listed(
                f"/api/v2/projects/{p}/environments/{env}/experiments?expand=currentIteration", "beta")
            if experiments is None:
                continue
            found = {e["key"]: e for e in experiments}
            ours = [s for s in specs if s["experiment"]["exp_env"] == env]
            self.expect("Experiment", [(s["experiment"]["exp_key"], s["experiment"]["exp_name"]) for s in ours],
                        set(found))
            for spec in ours:
                exp = found.get(spec["experiment"]["exp_key"])
                if exp and spec.get("start_iteration") and \
                        (exp.get("currentIteration") or {}).get("status") != "running":
                    self.missing.append(f"Experiment not running: {spec['experiment']['exp_name']}")

    def check_ai(self, p):
        configs = self.listed(f"/api/v2/projects/{p}/ai-configs", "beta")
        if configs is not None:
            found = {c["key"]: c for c in configs}
            specs = AI_CONFIGS + AGENT_CONFIGS
            self.expect("AI Config", [(s["config"]["config_key"], s["config"]["config_name"]) for s in specs],
                        set(found))
            for spec in specs:
                key, name = spec["config"]["config_key"], spec["config"]["config_name"]
                config = found.get(key)
                if not config:
                    continue
                have = {v.get("key") for v in config.get("variations", [])}
                for variation in spec["variations"]:
                    if variation["ai_config_version_key"] not in have:
                        self.missing.append(f"AI Config variation: {name} / {variation['ai_config_version_key']}")
                status, flag = self.get(f"/api/v2/flags/{p}/{key}?env={spec['environment']}")
                if flag is None or not flag["environments"][spec["environment"]]["on"]:
                    self.missing.append(f"AI Config not switched on: {name}")
                if spec.get("adaptive_trigger"):
                    self.check_adaptive_trigger(p, "ai-config", key, spec["environment"], name)

        graphs = self.listed(f"/api/v2/projects/{p}/agent-graphs", "beta")
        self.expect("Agent graph", [(g["graph_key"], g["graph_name"]) for g in AGENT_GRAPHS],
                    None if graphs is None else {g.get("key") for g in graphs})
        tools = self.listed(f"/api/v2/projects/{p}/ai-tools", "beta")
        self.expect("AI tool", [(t["tool_key"], t["tool_key"]) for t in AI_TOOLS],
                    None if tools is None else {t["key"] for t in tools})
        snippets = self.listed(f"/api/v2/projects/{p}/ai-configs/prompt-snippets", "beta")
        self.expect("Prompt snippet", [(s["key"], s.get("name") or s["key"]) for s in PROMPT_SNIPPETS],
                    None if snippets is None else {s["key"] for s in snippets})
        optimizations = self.listed(f"/api/v2/projects/{p}/agent-optimizations", "beta")
        self.expect("Agent optimization", [(o["key"], o["key"]) for o in AGENT_OPTIMIZATIONS],
                    None if optimizations is None else {o["key"] for o in optimizations})

        # Internal routes, as DemoBuilder uses; each project has only a few.
        status, body = self.get(f"/internal/projects/{p}/datasets", "beta")
        if body is None:
            self.missing.append(f"Couldn't read the datasets (HTTP {status})")
        else:
            self.expect("Dataset", [(d["name"], d["name"]) for d in DATASETS],
                        {d.get("name") for d in body.get("datasets", [])})
        status, body = self.get(f"/internal/projects/{p}/playgrounds", "beta")
        if body is None:
            self.missing.append(f"Couldn't read the playgrounds (HTTP {status})")
        else:
            found = {g.get("name"): g for g in body.get("items", [])}
            self.expect("Playground", [(g["name"], g["name"]) for g in PLAYGROUNDS], set(found))
            for spec in PLAYGROUNDS:
                playground = found.get(spec["name"])
                if playground and len(playground.get("variants") or []) < len(spec["variants"]):
                    self.missing.append(f"Playground missing a side: {spec['name']}")

    def check_reset_key(self, p):
        tokens = self.listed("/api/v2/tokens?showAll=true")
        if tokens is None:
            return
        count = sum(1 for t in tokens if t.get("name") == f"togglewear-reset-{p}")
        if count == 1:
            print("OK   Reset key")
        else:
            self.missing.append(f"Reset key: expected one, found {count}")


def report(project_key, missing):
    if not missing:
        print(f"\nEverything in demo_resources.py is in {project_key}.")
        return
    print(f"\n{len(missing)} thing(s) missing from {project_key}:")
    for item in missing:
        print(f"  - {item}")
        # Shown on the run's summary page as well as in the log.
        print(f"::error title=Not built::{item}")
    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"### Not everything was built in {project_key}\n\n")
            f.write("".join(f"- {item}\n" for item in missing))
            f.write("\nThe store is online. Fix the cause, then run Rebuild.\n")


if __name__ == "__main__":
    project_key = sys.argv[1] if len(sys.argv) > 1 else os.getenv("LD_PROJECT_KEY")
    api_key = os.getenv("LD_API_KEY")
    if not project_key or not api_key:
        sys.exit("LD_API_KEY and a project key (argument or LD_PROJECT_KEY) are required.")
    missing = BuildCheck(api_key, project_key).run()
    report(project_key, missing)
    sys.exit(1 if missing else 0)
