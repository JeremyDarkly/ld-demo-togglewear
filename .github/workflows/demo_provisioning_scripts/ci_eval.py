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
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime

from dotenv import load_dotenv
from langchain_aws import ChatBedrockConverse
from launchdarkly_ai_langchain_messages import create_langchain_messages_handler
from launchdarkly_ai_server import AIConfig, Judge, ProviderHandler, Scorer, init_evaluations, shutdown
from launchdarkly_ai_server.judge_scoring import numeric_score, parse_judge_response

from langchain_core.messages import HumanMessage, SystemMessage

from demo_resources import AGENT_CONFIGS, AGENT_OPTIMIZATIONS, AI_CONFIGS, CI_EVALS, PROMPT_SNIPPETS

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
    # In --json-out only: the answer the row was judged on, and the judge's
    # whole reasoning.
    answer: str = ""
    reasoning: str = ""


@dataclass
class Result:
    config: str
    variation: str
    dataset: str
    rows: int = 0
    # quick or full, and the dataset file's hash: a run is only compared row
    # by row with a baseline run of the same mode over the same rows.
    mode: str = ""
    dataset_sha: str = ""
    key: str = ""
    passed: bool | None = None
    url: str = ""
    summary: dict = field(default_factory=dict)
    misses: list = field(default_factory=list)
    error: str = ""
    # The first few distinct errors rows raised. The SDK counts those rows as
    # errors but doesn't say why.
    row_errors: list = field(default_factory=list)
    # judge key -> every score it gave, for the summary's mean and lowest.
    judge_scores: dict = field(default_factory=dict)


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


def row_label(metadata, row_input):
    """How a row is named in the summary: its scenario, or who and what it is about."""
    metadata = metadata or {}
    if metadata.get("scenario"):
        return metadata["scenario"]
    named = [metadata[k] for k in ("shopper", "product") if metadata.get(k)]
    question = " ".join(str(row_input).split())[:60]
    # A row about a product is named by it; otherwise its question says which it is.
    if "product" in metadata:
        return " / ".join(named)
    return f"{' / '.join(named)}: {question}" if named else question


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
        current.misses.append(Miss(row_label(metadata, row.input), f"{expected}, {points} points",
                                   f"{decision}, {score} points" if answer else f"no decision: {str(output)[:120]}"))
    return 1.0 if decision == expected else 0.0


def stylist_reply(output):
    """The reply as the page reads it (pickedFrom in pages/api/personal-stylist/index.ts)."""
    text = output if isinstance(output, str) else json.dumps(output)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        return None
    try:
        reply = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None
    return reply if isinstance(reply, dict) else None


def score_stylist_reply(row, output):
    """1.0 when the page can use the whole reply: a note, a pairing from the
    catalog it was given, and a size the product comes in.

    The page drops a size or a pairing it can't use and keeps the note, so a
    reply that fails here still shows, with part of it missing.
    """
    variables = row.variables or {}
    sizes = json.loads(variables.get("product_facts") or "{}").get("sizes") or []
    catalog = {p["slug"] for p in json.loads(variables.get("catalog") or "[]")}
    reply = stylist_reply(output)
    problems = []
    if reply is None:
        problems.append("not JSON")
    else:
        note = reply.get("note")
        if not isinstance(note, str) or not note.strip():
            problems.append("no note")
        elif len(note.split()) > 50:
            problems.append(f"note is {len(note.split())} words")
        if reply.get("pairing") not in catalog:
            problems.append(f"pairing {reply.get('pairing')!r} isn't in its catalog")
        if len(sizes) > 1 and reply.get("size") not in sizes:
            problems.append(f"size {reply.get('size')!r} isn't one of {', '.join(sizes)}")
    if problems and current is not None:
        current.misses.append(Miss(row_label(row.metadata, row.input), "a reply the page can use",
                                   "; ".join(problems), answer=str(output)))
    # Over 50 words is listed, but the page still shows it.
    return 0.0 if [p for p in problems if "words" not in p] else 1.0


SIGNAL_POINTS = re.compile(r"with (\d+) points")
SENTENCE_END = re.compile(r"[.!?](?:\s|$)")


def score_case_note(row, output):
    """1.0 when the note does what the Case Note prompt asks that code can check:
    three or four sentences, the decision, each signal's points, and plain text.

    Whether it gets the account history right and invents nothing is left to
    the acceptance statements.
    """
    note = output if isinstance(output, str) else json.dumps(output)
    metadata = row.metadata or {}
    problems = []
    # Order numbers and prices don't end a sentence, so a full stop counts
    # only before a space or the end.
    sentences = len(SENTENCE_END.findall(note.strip()))
    if not 3 <= sentences <= 4:
        problems.append(f"{sentences} sentences")
    decision = metadata.get("expected_decision")
    said = {"review": ("held", "review"), "decline": ("declin",)}.get(decision, ())
    if said and not any(word in note.lower() for word in said):
        problems.append(f"doesn't say it was {'held' if decision == 'review' else 'declined'}")
    for points in sorted(set(SIGNAL_POINTS.findall(row.input or ""))):
        if points not in note:
            problems.append(f"no {points}-point signal")
    if re.search(r"(^|\n)\s*([-*#]|\d+\.)\s|\*\*", note):
        problems.append("markdown")
    if problems and current is not None:
        current.misses.append(Miss(row_label(metadata, row.input), "the note the prompt asks for",
                                   "; ".join(problems), answer=note))
    return 0.0 if problems else 1.0


SCORERS = {"decision-matches-points": score_decision, "stylist-reply-usable": score_stylist_reply,
           "case-note-covers-the-case": score_case_note}


# ---- Acceptance statements ----
#
# An agent optimization's acceptance statements, each judged as a scorer of
# its own, by the optimization's judge model at its threshold. For a config
# with no judges attached, they say what a good answer is without CI having
# a judge config of its own in LaunchDarkly, which only has what
# demo_resources.py builds.
STATEMENT_JUDGE = (
    "You judge whether a response from an AI agent meets one statement. The message history "
    "is what the agent was handed, and the response is what it wrote.\n\n"
    "Statement: {statement}\n\n"
    "Score from 0 to 1 how fully the response meets the statement: 1.0 when it fully does, "
    "0.0 when it clearly doesn't. Explain your score in one or two sentences, naming what is "
    "missing or wrong."
)


def statement_scorers(optimization_key):
    optimization = next(o for o in AGENT_OPTIMIZATIONS if o["key"] == optimization_key)
    judge = bedrock_model({"model": {"name": optimization["judge_model"],
                                     "parameters": {"maxTokens": 500, "temperature": 0}}})
    judge = judge.with_structured_output(JUDGE_SCHEMA)

    def scorer(index, spec):
        name = f"{optimization_key}-{index}"

        async def fn(row, output):
            verdict = await judge.ainvoke([
                SystemMessage(STATEMENT_JUDGE.format(statement=spec["statement"])),
                HumanMessage(judge_request(row.input or "", output)),
            ])
            score = numeric_score(verdict.get("score"))
            if score is None:
                raise ValueError(f"{name} gave no score: {verdict}")
            if score < spec["threshold"] and current is not None:
                current.misses.append(Miss(
                    row_label(row.metadata, row.input), f"{name} ≥ {spec['threshold']}",
                    f"{score:.2f}: {' '.join(str(verdict.get('reasoning')).split())[:200]}",
                    answer=str(output), reasoning=str(verdict.get("reasoning"))))
            if current is not None:
                current.judge_scores.setdefault(name, []).append(score)
            return score

        return Scorer(name=name, fn=fn, threshold=spec["threshold"])

    return [scorer(i, spec) for i, spec in enumerate(optimization["acceptance_statements"], 1)]


# ---- What the judges see ----
#
# Each route in the store builds its own message history for the judges,
# and their rubrics rely on it. Keyed by config: a function of the dataset row
# and the answer that returns (message history, response), as that route
# builds them. A config with none gets the row's input and the answer.

def _order_decision_view(row, answer):
    # pages/api/order-review/index.ts adds the total, which the Decision
    # Policy judge reads from the last line.
    points = row["metadata"]["risk_points"]
    return f"{row['input']}\n\nRisk points the specialists' tools found: {points}.", answer


def _stylist_view(row, answer):
    # pages/api/personal-stylist/index.ts gives the judges the facts in the
    # chat's "data:" form, and the reply as the page shows it.
    v = row["variables"]
    product = json.loads(v["product_facts"])
    history = "\n".join([f"request: The stylist note for {product['name']}",
                         f"data: product {v['product_facts']}",
                         f"data: orders {v['order_history']}",
                         f"data: catalog {v['catalog']}"])
    reply = stylist_reply(answer) or {}
    names = {p["slug"]: p["name"] for p in json.loads(v["catalog"])}
    size = reply.get("size") if len(product.get("sizes") or []) > 1 else None
    response = "\n".join([f"Size: {size or 'one size'}",
                          f"Pairing: {names.get(reply.get('pairing'), 'none')}",
                          f"Note: {reply.get('note', '')}"])
    return history, response


def _swag_view(row, answer):
    # pages/api/swag-assistant/index.ts: the conversation, then each tool call
    # and what it returned, which tool_results already has as "tool:" lines.
    tools = row["variables"].get("tool_results", "")
    return "\n".join([f"user: {row['input']}"] + ([tools] if tools else [])), answer


JUDGE_VIEWS = {
    "fraud-decision-agent": _order_decision_view,
    "personal-stylist": _stylist_view,
    "swag-assistant": _swag_view,
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


def judge_request(history, response):
    return f"MESSAGE HISTORY:\n{history}\n\nRESPONSE TO EVALUATE:\n{response}"


def row_key(row_input, variables, names):
    """Which row a judge call is for. Inputs repeat (four rows are the stylist
    note for the hoodie), so the row's own variables are part of it."""
    return json.dumps([row_input, {k: (variables or {}).get(k) for k in sorted(names)}])


def recording_handler(inner, result, rows, judge_view, thresholds):
    """Wrap the handler to ask judges as the store does, and record low judge scores."""
    names = {k for r in rows for k in r["variables"]}
    by_key = {row_key(r["input"], r["variables"], names): r for r in rows}

    async def recorded(config, user_input=None, tool_handlers=None, variables=None, history=None):
        judging = bool(variables) and "formatting_instructions" in variables
        row = by_key.get(row_key(variables.get("input", ""), variables, names)) if judging else None
        if judging:
            if row is None:
                raise RuntimeError("judge call for a row ci_eval.py can't find")
            view = judge_view or (lambda r, answer: (r["input"], answer))
            user_input = judge_request(*view(row, user_input))
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
            if score is not None:
                result.judge_scores.setdefault(threshold[0], []).append(score)
            if score is not None and score < threshold[1]:
                result.misses.append(Miss(row_label(row.get("metadata"), row["input"]), f"{threshold[0]} ≥ {threshold[1]}",
                                          f"{score:.2f}: {' '.join(str(reason).split())[:200]}",
                                          answer=str(user_input).rsplit("RESPONSE TO EVALUATE:\n", 1)[-1],
                                          reasoning=str(reason)))
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


def generation_for(target, variation, replace=()):
    """The variation as demo_resources.py defines it, over what LaunchDarkly has.

    replace is (old, new) pairs applied to its prompt, to try a change, such as
    a negative control, without editing demo_resources.py.
    """
    model = variation["model"]
    generation = {"model": model["modelName"], "parameters": dict(model.get("parameters", {}))}
    if "instructions" in variation:
        generation["instructions"] = fill_snippets(variation["instructions"])
    else:
        generation["messages"] = [{**m, "content": fill_snippets(m["content"])} for m in variation["messages"]]
    # A prompt with no user message of its own, which the store fills in
    # with the conversation, gets the entry's user_message for the row.
    if "user_message" in target:
        generation["messages"] = generation["messages"] + [{"role": "user", "content": target["user_message"]}]
    for old, new in replace:
        prompt = json.dumps(generation.get("instructions", generation.get("messages")))
        if json.dumps(old)[1:-1] not in prompt:
            raise SystemExit(f"error: --replace {old!r} is not in {target['config']}'s prompt")
        if "instructions" in generation:
            generation["instructions"] = generation["instructions"].replace(old, new)
        else:
            generation["messages"] = [{**m, "content": m["content"].replace(old, new)} for m in generation["messages"]]
    if "output_format" in target:
        generation["output_format"] = target["output_format"]
    return generation


def rows_for(target, quick):
    """The dataset's rows, in the shape run() takes."""
    with open(os.path.join(HERE, "datasets", target["dataset"]), encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]
    if quick and isinstance(target.get("quick"), int):
        rows = rows[:target["quick"]]
    elif quick and target.get("quick"):
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
    result = Result(target["config"], variation_key, target["dataset"], rows=len(rows),
                    mode="quick" if args.quick else "full", dataset_sha=dataset_sha(target["dataset"]))
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    result.key = f"ci-{args.label}-{target['config']}-{variation_key}-{stamp}"
    print(f"running {target['config']}/{variation_key} on {len(rows)} rows of {target['dataset']}", flush=True)
    current = result
    try:
        run = await evals.run(
            key=result.key,
            dataset=rows,
            ai_config=AIConfig(key=target["config"], variation=variation_key),
            generation=generation_for(target, variation, args.replace or ()),
            handler=recording_handler(
                create_langchain_messages_handler(bedrock_model), result, rows,
                JUDGE_VIEWS.get(target["config"]), await judge_thresholds(evals, spec)),
            # The store's Order Review agents call their tools before they're
            # handed on; the datasets carry what the tools found.
            tools=[],
            criteria=[Scorer(name=name, fn=SCORERS[name]) for name in target.get("scorers", [])]
            + (statement_scorers(target["statements"]) if "statements" in target else [])
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


def dataset_sha(name):
    with open(os.path.join(HERE, "datasets", name), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:12]


# ---- What changed ----
#
# --changed BASE evaluates only what a change could affect: each target
# whose definition differs from the one in demo_resources.py at BASE. A
# target's definition is everything that decides its result: its CI_EVALS
# entry, the variation, its judges' configs, the prompt snippets, the
# optimization its statements come from, and its dataset file.

def git(*args):
    return subprocess.run(["git", *args], cwd=HERE, capture_output=True, text=True)


def repo_path(name):
    top = git("rev-parse", "--show-toplevel").stdout.strip()
    return os.path.relpath(os.path.join(HERE, name), top)


def definition(resources, config, variation_key, dataset_text):
    configs = resources.get("AI_CONFIGS", []) + resources.get("AGENT_CONFIGS", [])
    spec = next((s for s in configs if s["config"]["config_key"] == config), None)
    target = next((t for t in resources.get("CI_EVALS", []) if t["config"] == config), None)
    if spec is None or target is None:
        return None
    judges = [next((s for s in configs if s["config"]["config_key"] == j["judgeConfigKey"]), None)
              for j in spec.get("judges", [])]
    optimization = next((o for o in resources.get("AGENT_OPTIMIZATIONS", [])
                         if o["key"] == target.get("statements")), None)
    return json.dumps({
        "target": target,
        "variation": next((v for v in spec["variations"] if v["ai_config_version_key"] == variation_key), None),
        "judges": judges, "attached": spec.get("judges", []),
        "snippets": resources.get("PROMPT_SNIPPETS", []),
        "optimization": optimization, "dataset": dataset_text,
    }, sort_keys=True, default=str)


def changed_since(base, pairs):
    """The (target, variation) pairs whose definition differs at base, and
    whether the runner itself changed, in which case every pair is."""
    if git("cat-file", "-e", f"{base}^{{commit}}").returncode != 0:
        return pairs, True  # an unknown base, such as the first push of a branch
    # :(top) because git reads a path argument from the directory it runs in.
    code = git("diff", "--name-only", base, "HEAD", "--",
               *(f":(top){repo_path(name)}" for name in ("ci_eval.py", "requirements-ci-eval.txt"))).stdout.strip()
    if code:
        return pairs, True
    shown = git("show", f"{base}:{repo_path('demo_resources.py')}")
    base_resources = {}
    if shown.returncode == 0:
        exec(compile(shown.stdout, "demo_resources.py@base", "exec"), base_resources)
    import demo_resources
    changed = []
    for target, variation in pairs:
        name = os.path.join("datasets", target["dataset"])
        with open(os.path.join(HERE, name), encoding="utf-8") as f:
            now_text = f.read()
        then = git("show", f"{base}:{repo_path(name)}")
        now = definition(vars(demo_resources), target["config"], variation, now_text)
        before = definition(base_resources, target["config"], variation,
                            then.stdout if then.returncode == 0 else None)
        if now != before:
            changed.append((target, variation))
    return changed, False


# ---- Compared with a baseline ----

def miss_key(miss):
    return (miss["row"], miss["expected"]) if isinstance(miss, dict) else (miss.row, miss.expected)


def comparison(results, baseline):
    """Markdown comparing each result with the baseline run of the same
    config, variation and mode, or None with no baseline at all."""
    if baseline is None:
        return None
    lines = ["", "### Compared with `main`", ""]
    for r in results:
        if r.error:
            continue
        then = next((b for b in baseline if (b["config"], b["variation"], b.get("mode"))
                     == (r.config, r.variation, r.mode) and not b.get("error")), None)
        name = f"`{r.config}/{r.variation}`"
        if then is None:
            lines.append(f"- {name}: no result on `main` to compare with yet.")
            continue
        passed = f"{then['summary'].get('passed')}/{then['summary'].get('total')} → " \
                 f"{r.summary.get('passed')}/{r.summary.get('total')}"
        means = []
        for judge, scores in sorted(r.judge_scores.items()):
            before = then.get("judge_scores", {}).get(judge)
            if before:
                delta = sum(scores) / len(scores) - sum(before) / len(before)
                means.append(f"{judge} {sum(before) / len(before):.2f} → {sum(scores) / len(scores):.2f}"
                             + (f" ({delta:+.2f})" if abs(delta) >= 0.005 else ""))
        lines.append(f"- {name}: rows passed {passed}" + (f"; {'; '.join(means)}" if means else ""))
        if then.get("dataset_sha") != r.dataset_sha:
            lines.append("  - The dataset changed, so rows aren't compared one by one.")
            continue
        listed_then = {miss_key(m) for m in then.get("misses", [])}
        listed_now = {miss_key(m) for m in r.misses}
        for row, expected in sorted(listed_now - listed_then):
            lines.append(f"  - Newly listed: {row}, {expected}")
        for row, expected in sorted(listed_then - listed_now):
            lines.append(f"  - No longer listed: {row}, {expected}")
    return "\n".join(lines) + "\n"


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
        for judge, scores in r.judge_scores.items():
            lines.append(f"\n`{r.config}/{r.variation}` {judge}: mean {sum(scores) / len(scores):.2f}, "
                         f"lowest {min(scores):.2f}, over {len(scores)} rows")
        if r.row_errors:
            lines += ["", f"**{r.config}/{r.variation} row errors:**", ""]
            lines += [f"- `{e}`" for e in r.row_errors]
        if r.misses:
            lines += ["", f"<details><summary>{r.config}/{r.variation}: {len(r.misses)} to look at</summary>", "",
                      "| Row | Expected | Actual |", "|---|---|---|"]
            lines += [f"| {m.row} | {m.expected} | {m.actual.replace('|', '/')} |" for m in r.misses]
            lines += ["", "</details>"]
    return "\n".join(lines) + "\n"


def load_baseline(path):
    if not path or not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_summary(text, args):
    print(text)
    if args.summary_file:
        with open(args.summary_file, "a", encoding="utf-8") as f:
            f.write(text)


async def main(args):
    targets = [t for t in CI_EVALS if not args.config or t["config"] in args.config]
    if not targets:
        sys.exit(f"error: no CI_EVALS entry for {', '.join(args.config)}")
    pairs = [(t, v) for t in targets
             for v in ([args.variation] if args.variation
                       else t.get("variations", [spec_for(t["config"])["fallthrough"]]))]
    if args.changed:
        pairs, everything = changed_since(args.changed, pairs)
        if everything:
            # The runner itself changed, so its result could differ for any
            # target: all of them, on their quick rows.
            args.quick = True
        if not pairs:
            write_summary("## Offline evals\n\nNo AI Config, judge, prompt snippet or dataset that CI "
                          f"evaluates changed since `{args.changed[:7]}`, so nothing was evaluated.\n", args)
            for out in (args.json_out, args.baseline_out):
                if out:
                    with open(out, "w", encoding="utf-8") as f:
                        json.dump([] if out == args.json_out else load_baseline(args.baseline) or [], f)
            return 0
    baseline = load_baseline(args.baseline)
    evals = init_evaluations(project_key=os.environ["LD_PROJECT_KEY"], api_key=os.environ["LD_API_KEY"],
                             sdk_key=os.environ["LD_SDK_KEY"])
    results = []
    try:
        for target, variation in pairs:
            results.append(await run_target(evals, target, variation, args))
    finally:
        await shutdown()
    text = markdown(results)
    if args.baseline:
        text += comparison(results, baseline) or (
            "\n### Compared with `main`\n\nNo result from `main` to compare with yet.\n")
    write_summary(text, args)
    saved = [r.__dict__ | {"misses": [m.__dict__ for m in r.misses]} for r in results]
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(saved, f, indent=2)
    if args.baseline_out:
        # A run on main may evaluate only what changed, so the baseline keeps
        # every other target's latest result and replaces this run's.
        ran = {(r["config"], r["variation"], r["mode"]) for r in saved if not r["error"]}
        kept = [b for b in baseline or [] if (b["config"], b["variation"], b.get("mode")) not in ran]
        with open(args.baseline_out, "w", encoding="utf-8") as f:
            json.dump(kept + [r for r in saved if not r["error"]], f, indent=2)
    return 1 if any(r.error for r in results) else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", action="append", help="only this config; repeat for more")
    parser.add_argument("--variation", help="this variation instead of the one the default rule serves")
    parser.add_argument("--quick", action="store_true", help="only the rows named in quick")
    parser.add_argument("--replace", nargs=2, action="append", metavar=("OLD", "NEW"),
                        help="replace OLD with NEW in the prompt; repeat for more")
    parser.add_argument("--label", default="local", help="goes in each run's key, such as pr-12")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--summary-file", default=os.getenv("GITHUB_STEP_SUMMARY"))
    parser.add_argument("--json-out")
    parser.add_argument("--changed", metavar="BASE",
                        help="only what changed since this commit; everything, quick, if ci_eval.py did")
    parser.add_argument("--baseline", metavar="FILE",
                        help="a --baseline-out from main to compare with; a missing file is noted, not an error")
    parser.add_argument("--baseline-out", metavar="FILE",
                        help="write the baseline with this run's results in place of their earlier ones")
    sys.exit(asyncio.run(main(parser.parse_args())))
