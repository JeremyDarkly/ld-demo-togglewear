"""Evaluate the store's AI Configs offline, as demo_resources.py defines them.

    python ci_eval.py [--config fraud-decision-agent] [--variation claude-sonnet-4-6] [--quick]

For each entry in CI_EVALS, the AI SDK generates an answer for every row of
its dataset in datasets/, on Bedrock with your AWS credentials, then runs the
entry's scorers and the judges attached to the variation. The variation's
model, parameters and prompt come from demo_resources.py rather than from
LaunchDarkly, so a commit is evaluated before any project has it. The project
in .env only has to hold the judges, and the evaluations land there.

Results are advisory: a failed verdict is reported, not raised. The script
exits non-zero only when a run can't be completed. It writes a Markdown
summary to --summary-file, $GITHUB_STEP_SUMMARY in GitHub Actions.

Needs requirements-ci-eval.txt, LD_API_KEY, LD_PROJECT_KEY and LD_SDK_KEY in
.env or the environment, and AWS credentials with Bedrock.
"""

import argparse
import asyncio
import json
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime

from dotenv import load_dotenv
from langchain_aws import ChatBedrockConverse
from launchdarkly_ai_langchain_messages import create_langchain_messages_handler
from launchdarkly_ai_server import AIConfig, Judge, ProviderHandler, Scorer, init_evaluations, shutdown
from launchdarkly_ai_server.judge_scoring import numeric_score, parse_judge_response

from demo_resources import AGENT_CONFIGS, AI_CONFIGS, CI_EVALS, PROMPT_SNIPPETS

HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, "..", "..", "..", ".env"))

# LaunchDarkly fills {{snippet.<key>#<version>}} in when it serves a config,
# but the SDK's own templates don't match a key with a dash or a version, so a
# prompt taken from demo_resources.py has them filled in here.
SNIPPET = re.compile(r"\{\{snippet\.([a-z0-9-]+)#\d+\}\}")
SNIPPETS = {spec["key"]: spec["text"] for spec in PROMPT_SNIPPETS}


def fill_snippets(text):
    return SNIPPET.sub(lambda m: SNIPPETS[m.group(1)], text)


@dataclass
class Miss:
    row: str
    expected: str
    actual: str


@dataclass
class Result:
    config: str
    variation: str
    dataset: str
    rows: int = 0
    key: str = ""
    passed: bool | None = None
    url: str = ""
    summary: dict = field(default_factory=dict)
    misses: list = field(default_factory=list)
    error: str = ""
    # The first few distinct errors rows raised. The SDK counts those rows as
    # errors but doesn't say why.
    row_errors: list = field(default_factory=list)


# ---- Scorers ----
#
# Each records its misses on the Result being run, since LaunchDarkly's run
# summary only counts rows.

current = None


def answer_of(output):
    """The answer filled in to output_format, as a dict, or None."""
    if isinstance(output, dict):
        return output
    try:
        answer = json.loads(output or "")
    except (TypeError, json.JSONDecodeError):
        return None
    return answer if isinstance(answer, dict) else None


def score_decision(row, output):
    """1.0 when the decision is the one the row's risk points call for.

    The store acts on the decision alone (parseDecision in
    pages/api/order-review/index.ts), so a wrong total with the right decision
    passes, but is listed.
    """
    metadata = row.metadata or {}
    expected, points = metadata.get("expected_decision"), metadata.get("risk_points")
    answer = answer_of(output) or {}
    decision, score = answer.get("decision"), answer.get("score")
    if current is not None and (decision != expected or score != points):
        current.misses.append(Miss(metadata.get("scenario", ""), f"{expected}, {points} points",
                                   f"{decision}, {score} points" if answer else f"no decision: {str(output)[:120]}"))
    return 1.0 if decision == expected else 0.0


SCORERS = {"decision-matches-points": score_decision}


# ---- What the judges see ----
#
# The store gives a judge more than the agent's input in places, and the
# rubric relies on it. Keyed by config: a function of the row's metadata that
# returns what to add to the judge's message history.
JUDGE_CONTEXT = {
    # pages/api/order-review/index.ts adds the total, which the Decision
    # Policy judge reads from the last line.
    "fraud-decision-agent":
        lambda m: f"\n\nRisk points the specialists' tools found: {m['risk_points']}.",
}

# How the store's AI SDK (Node, Judge.evaluate) asks a judge: the conversation
# and the response in one user message, answered by filling in this schema.
# The Python SDK's offline runner sends only the response, and leaves the
# conversation to a {{message_history}} our judges' prompts don't have, so
# the judges are asked the store's way here. LangChain needs the title for
# Bedrock.
JUDGE_SCHEMA = {
    "title": "evaluation",
    "description": "The score and the reasoning behind it.",
    "type": "object",
    "properties": {"score": {"type": "number", "minimum": 0, "maximum": 1,
                             "description": "Score between 0.0 and 1.0."},
                   "reasoning": {"type": "string", "description": "Reasoning behind the score."}},
    "required": ["score", "reasoning"],
}


def judge_request(user_input, variables):
    return f"MESSAGE HISTORY:\n{variables.get('input', '')}\n\nRESPONSE TO EVALUATE:\n{user_input}"


def recording_handler(inner, result, rows_by_input, judge_context, thresholds):
    """Wrap the handler to ask judges as the store does, and record low judge scores."""

    async def recorded(config, user_input=None, tool_handlers=None, variables=None, history=None):
        judging = bool(variables) and "formatting_instructions" in variables
        row = rows_by_input.get((variables or {}).get("input", "")) if judging else None
        if judging:
            extra = judge_context(row.get("metadata") or {}) if row and judge_context else ""
            user_input = judge_request(user_input, {**variables, "input": variables.get("input", "") + extra})
            config = {**config, "outputFormat": JUDGE_SCHEMA}
        try:
            output = await inner(config, user_input, tool_handlers, variables, history)
        except Exception as error:
            message = f"{type(error).__name__}: {error}"[:300]
            if message not in result.row_errors and len(result.row_errors) < 3:
                result.row_errors.append(message)
            raise
        # An output_format answer comes back as a dict, which the SDK hands
        # the judges as their user message, and LangChain refuses. The store
        # has it as JSON text, so the judges get that.
        if not judging and isinstance(output.get("output"), dict):
            output = {**output, "output": json.dumps(output["output"])}
        threshold = thresholds.get(config.get("evaluationMetricKey", ""))
        if judging and threshold is not None:
            try:
                raw, reason = parse_judge_response(output.get("output", output.get("response")))
            except ValueError:
                return output  # the SDK reports it as an invalid judge output
            score = numeric_score(raw)
            if score is not None and score < threshold[1]:
                scenario = ((row or {}).get("metadata") or {}).get("scenario", "")
                result.misses.append(Miss(scenario, f"{threshold[0]} ≥ {threshold[1]}",
                                          f"{score:.2f}: {' '.join(str(reason).split())[:200]}"))
        return output

    return ProviderHandler(recorded, provides_for=inner.provides_for, capture_content=inner.capture_content)


# ---- Running ----

# LaunchDarkly's parameter names, as LangChain's Bedrock model takes them. The
# handler would pass maxTokens on as an extra field in the request to Bedrock,
# for the config under test and for every judge.
BEDROCK_PARAMETERS = {"maxTokens": "max_tokens", "temperature": "temperature", "topP": "top_p"}


def bedrock_model(invocation):
    """The LangChain model for a call, for the handler to use in place of its own."""
    model = invocation.get("model") or {}
    parameters = model.get("parameters") or {}
    return ChatBedrockConverse(
        model=model["name"], region_name=os.getenv("AWS_REGION", "us-east-1"),
        **{BEDROCK_PARAMETERS[k]: v for k, v in parameters.items() if k in BEDROCK_PARAMETERS and v is not None})


def spec_for(config_key):
    return next(s for s in AI_CONFIGS + AGENT_CONFIGS if s["config"]["config_key"] == config_key)


def generation_for(target, variation):
    """The variation as demo_resources.py defines it, over what LaunchDarkly has."""
    model = variation["model"]
    generation = {"model": model["modelName"], "parameters": dict(model.get("parameters", {}))}
    if "instructions" in variation:
        generation["instructions"] = fill_snippets(variation["instructions"])
    else:
        generation["messages"] = [{**m, "content": fill_snippets(m["content"])} for m in variation["messages"]]
    if "output_format" in target:
        generation["output_format"] = target["output_format"]
    return generation


def rows_for(target, quick):
    """The dataset's rows, in the shape run() takes."""
    with open(os.path.join(HERE, "datasets", target["dataset"]), encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]
    if quick and target.get("quick"):
        rows = [r for r in rows if r.get("metadata", {}).get("scenario") in target["quick"]]
    return [{"input": r["input"], "expectedOutput": r.get("expected_output", ""),
             "variables": r.get("variables", {}), "metadata": r.get("metadata", {})} for r in rows]


async def judge_thresholds(evals, spec):
    """evaluationMetricKey -> (judge key, threshold), since a judge call carries only the metric key."""
    thresholds = {}
    for judge in spec.get("judges", []):
        config = await asyncio.to_thread(
            evals.api.get, f"projects/{evals.project_key}/ai-configs/{judge['judgeConfigKey']}")
        thresholds[config["evaluationMetricKey"]] = (judge["judgeConfigKey"], judge.get("threshold", 0.7))
    return thresholds


async def run_target(evals, target, variation_key, args):
    global current
    spec = spec_for(target["config"])
    variation = next(v for v in spec["variations"] if v["ai_config_version_key"] == variation_key)
    rows = rows_for(target, args.quick)
    result = Result(target["config"], variation_key, target["dataset"], rows=len(rows))
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    result.key = f"ci-{args.label}-{target['config']}-{variation_key}-{stamp}"
    print(f"running {target['config']}/{variation_key} on {len(rows)} rows of {target['dataset']}", flush=True)
    current = result
    try:
        run = await evals.run(
            key=result.key,
            dataset=rows,
            ai_config=AIConfig(key=target["config"], variation=variation_key),
            generation=generation_for(target, variation),
            handler=recording_handler(
                create_langchain_messages_handler(bedrock_model), result, {r["input"]: r for r in rows},
                JUDGE_CONTEXT.get(target["config"]), await judge_thresholds(evals, spec)),
            # The store's Order Review agents call their tools before they're
            # handed on; the datasets carry what the tools found.
            tools=[],
            criteria=[Scorer(name=name, fn=SCORERS[name]) for name in target.get("scorers", [])]
            + [Judge(key=j["judgeConfigKey"]) for j in spec.get("judges", [])],
            concurrency=args.concurrency,
            poll_timeout_seconds=600,
        )
    except Exception as error:  # report every target, then exit non-zero
        result.error = f"{type(error).__name__}: {error}"
        return result
    finally:
        current = None
    result.passed, result.url = run.passed, run.url
    s = run.summary
    result.summary = {"total": s.total_rows, "passed": s.passed_rows, "failed": s.failed_rows,
                      "errors": s.error_rows}
    return result


def markdown(results):
    lines = ["## Offline evals", "",
             "| Config | Variation | Dataset | Rows passed | Verdict | Run |",
             "|---|---|---|---|---|---|"]
    for r in results:
        if r.error:
            verdict, passed = f"error: {r.error[:150]}", "–"
        else:
            verdict = "passed" if r.passed else "failed"
            passed = f"{r.summary.get('passed', 0)}/{r.summary.get('total', r.rows)}"
            if r.summary.get("errors"):
                passed += f" ({r.summary['errors']} errors)"
        run = f"[{r.key}]({r.url})" if r.url else r.key
        lines.append(f"| `{r.config}` | `{r.variation}` | `{r.dataset}` | {passed} | {verdict} | {run} |")
    for r in results:
        if r.row_errors:
            lines += ["", f"**{r.config}/{r.variation} row errors:**", ""]
            lines += [f"- `{e}`" for e in r.row_errors]
        if r.misses:
            lines += ["", f"<details><summary>{r.config}/{r.variation}: {len(r.misses)} to look at</summary>", "",
                      "| Row | Expected | Actual |", "|---|---|---|"]
            lines += [f"| {m.row} | {m.expected} | {m.actual.replace('|', '/')} |" for m in r.misses]
            lines += ["", "</details>"]
    return "\n".join(lines) + "\n"


async def main(args):
    targets = [t for t in CI_EVALS if not args.config or t["config"] in args.config]
    if not targets:
        sys.exit(f"error: no CI_EVALS entry for {', '.join(args.config)}")
    evals = init_evaluations(project_key=os.environ["LD_PROJECT_KEY"], api_key=os.environ["LD_API_KEY"],
                             sdk_key=os.environ["LD_SDK_KEY"])
    results = []
    try:
        for target in targets:
            spec = spec_for(target["config"])
            variation = args.variation or spec["fallthrough"]
            results.append(await run_target(evals, target, variation, args))
    finally:
        await shutdown()
    text = markdown(results)
    print(text)
    if args.summary_file:
        with open(args.summary_file, "a", encoding="utf-8") as f:
            f.write(text)
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump([r.__dict__ | {"misses": [m.__dict__ for m in r.misses]} for r in results], f, indent=2)
    return 1 if any(r.error for r in results) else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", action="append", help="only this config; repeat for more")
    parser.add_argument("--variation", help="this variation instead of the one the default rule serves")
    parser.add_argument("--quick", action="store_true", help="only the rows named in quick")
    parser.add_argument("--label", default="local", help="goes in each run's key, such as pr-12")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--summary-file", default=os.getenv("GITHUB_STEP_SUMMARY"))
    parser.add_argument("--json-out")
    sys.exit(asyncio.run(main(parser.parse_args())))
