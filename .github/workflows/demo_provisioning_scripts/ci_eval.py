"""Evaluate the store's AI Configs offline, as demo_resources.py defines them.

    python ci_eval.py [--config fraud-decision-agent] [--variation claude-sonnet-4-6] [--quick]

For each entry in CI_EVALS, and each variation its config's targeting serves,
the AI SDK generates an answer for every row of its dataset in datasets/, on
Bedrock with your AWS credentials, then runs the entry's scorers and the
judges attached to the variation. The variation's model, parameters and
prompt come from demo_resources.py rather than from LaunchDarkly, so a commit
is evaluated before any project has it. The project in .env only has to hold
the judges, and the evaluations land there.

Before any model call, each dataset is checked: a duplicate row or a line
outside ASCII stops the run, and a row too long for LaunchDarkly's upload
screen is a warning in the summary.

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
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import UTC, datetime
from math import isfinite

from dotenv import load_dotenv
from langchain_aws import ChatBedrockConverse
from launchdarkly_ai_langchain_agents import create_langchain_agents_handler
from launchdarkly_ai_langchain_messages import create_langchain_messages_handler
from launchdarkly_ai_server import (AIConfig, EvaluationsError, Judge, ProviderHandler, Scorer, init_evaluations,
                                   parse_json_with_possible_fences, shutdown)

from langchain_core.messages import HumanMessage, SystemMessage

import swag_tools
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
    # What serves the variation, from served_variations: empty when only a
    # variations override or --variation picked it.
    served_by: list = field(default_factory=list)
    # The stand-in tools the model was given, by key: empty for an entry
    # without tools.
    tools: list = field(default_factory=list)


# ---- Scorers ----
#
# Each records its misses on the Result being run, since LaunchDarkly's run
# summary only counts rows.

current = None


def answer_of(output):
    """The answer filled in to output_format, as a dict, or None.

    It may come as JSON text, which the model may put in a fence.
    """
    if isinstance(output, dict):
        return output
    answer = parse_json_with_possible_fences(output) if isinstance(output, str) else None
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

def _order_decision_view(row, answer, **_):
    # pages/api/order-review/index.ts adds the total, which the Decision
    # Policy judge reads from the last line.
    points = row["metadata"]["risk_points"]
    return f"{row['input']}\n\nRisk points the specialists' tools found: {points}.", answer


def _stylist_view(row, answer, **_):
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


# One call in the trajectory the SDK puts in a judge's message_history
# (render_trajectory in launchdarkly_ai_server/trajectory.py).
TRAJECTORY_CALL = re.compile(r"^\d+\. (\S+)\n   arguments: (.*?)\n   (result|error): (.*?)(?=\n\d+\. |\n\(\d+ further|\Z)",
                             re.M | re.S)
TRUNCATED = "… (truncated)"


def tool_lines(message_history, calls=None):
    """The row's tool calls as "tool:" lines, from the trajectory the SDK
    recorded, with the tools it listed as available or its note that none was
    called.

    The SDK cuts a result over 2,000 characters short, which would hide most
    of a browse of the catalogue from the judges, so a cut result is filled in
    from calls, the stand-ins' own record of the row's calls in order.
    """
    block = next((part for part in message_history.split("\n\n")
                  if part.startswith(("Tools available: ", "Tool calls made ", "No tool calls "))), "")
    lines = [line for line in block.split("\n")
             if line.startswith(("Tools available: ", "No tool calls ", "("))]
    for position, (name, arguments, kind, value) in enumerate(TRAJECTORY_CALL.findall(block)):
        full = calls[position] if calls and position < len(calls) else None
        if kind == "result" and value.endswith(TRUNCATED) and full and full[0] == name:
            value = json.dumps(full[2], separators=(",", ":"), ensure_ascii=False)
        lines.append(f"tool: {name}({arguments}) -> " + (f"error: {value}" if kind == "error" else value))
    return "\n".join(lines)


def _swag_view(row, answer, variables=None, calls=None):
    # pages/api/swag-assistant/index.ts: the conversation, then each tool call
    # and what it returned, as "tool:" lines. A row with tool_results has
    # them already; with stand-in tools they come from the SDK's trajectory.
    if "tool_results" in row["variables"]:
        tools = row["variables"]["tool_results"]
    else:
        tools = tool_lines((variables or {}).get("message_history", ""), calls)
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


def numeric_score(score):
    """The score as a float, or None when it isn't a finite number. A bool isn't one."""
    if isinstance(score, bool) or not isinstance(score, (int, float)):
        return None
    return float(score) if isfinite(score) else None


def parse_judge_response(raw):
    """(score, reasoning) from a judge's answer, as the SDK reads it.

    The SDK's own parser is in an internal module, so this does what it does
    with the JSON parser it exports. Raises ValueError when the answer isn't a
    JSON object.
    """
    parsed = raw if isinstance(raw, dict) else parse_json_with_possible_fences(raw) if isinstance(raw, str) else None
    if not isinstance(parsed, dict) or not parsed:
        raise ValueError("Invalid JSON from judge")
    return parsed.get("score"), parsed.get("reasoning") or parsed.get("reason") or ""


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
    # Row id -> the stand-in tools' calls for it, for the judges.
    tool_calls = {}

    async def recorded(config, user_input=None, tool_handlers=None, variables=None, history=None):
        judging = bool(variables) and "formatting_instructions" in variables
        row = by_key.get(row_key(variables.get("input", ""), variables, names)) if judging else None
        if judging:
            if row is None:
                raise RuntimeError("judge call for a row ci_eval.py can't find")
            view = judge_view or (lambda r, answer, **_: (r["input"], answer))
            user_input = judge_request(*view(row, user_input, variables=variables, calls=tool_calls.get(id(row))))
            config = {**config, "outputFormat": JUDGE_SCHEMA}
        elif tool_handlers:
            # The stand-ins answer as the row's shopper. Set here, in the
            # row's own task, so the tool calls the handler makes see it.
            generating = by_key.get(row_key(user_input or "", variables, names))
            swag_tools.SHOPPER.set(((generating or {}).get("metadata") or {}).get("shopper"))
            if generating is not None:
                tool_calls[id(generating)] = []
                swag_tools.CALLS.set(tool_calls[id(generating)])
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

    return ProviderHandler(recorded, provides_for=inner.provides_for, capture_content=inner.capture_content,
                           providers=inner.providers)


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


def agent_handler(llm):
    """The handler for agent-mode configs, which binds their output_format.

    The agents handler only asks for output_format in the system prompt and
    returns the model's text, so fraud-decision-agent wrote its decision
    freehand and got the threshold wrong. A config with output_format goes to
    the messages handler instead, which fills it in with structured output, as
    the store's order review does. The CI runs pass no tools, so these configs
    need no tool loop. case-note-agent, which has no output_format, stays on
    the agents handler.
    """
    agents = create_langchain_agents_handler(llm)
    structured = create_langchain_messages_handler(llm)

    async def call(config, user_input=None, tool_handlers=None, variables=None, history=None):
        inner = structured if config.get("outputFormat") else agents
        return await inner(config, user_input, tool_handlers, variables, history)

    return ProviderHandler(call, provides_for=agents.provides_for, capture_content=agents.capture_content,
                           providers=agents.providers)


def ld_get(path):
    """GET from the LaunchDarkly REST API, for the judge configs the SDK doesn't read for us.

    The SDK's own API client is internal, so this sends the same request it would.
    """
    base = (os.getenv("LD_API_BASE_URI") or "https://app.launchdarkly.com").strip().rstrip("/")
    request = urllib.request.Request(f"{base}/api/v2/{path.lstrip('/')}", headers={
        "Authorization": os.environ["LD_API_KEY"], "Accept": "application/json", "LD-API-Version": "20240415"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="replace")[:300]
        raise EvaluationsError(f"LaunchDarkly API GET {path} failed with {error.code}: {body}") from None


def spec_for(config_key):
    return next(s for s in AI_CONFIGS + AGENT_CONFIGS if s["config"]["config_key"] == config_key)


def clause_label(clause):
    """A targeting clause as the summary names it, such as "segments gold-members"."""
    values = ", ".join(str(v).lower() if isinstance(v, bool) else str(v) for v in clause.get("values", []))
    if clause.get("op") == "segmentMatch":
        label = f"segments {values}"
    else:
        label = f"{clause.get('attribute')} {clause.get('op')} {values}"
    return f"not {label}" if clause.get("negate") else label


def served_variations(spec):
    """Variation key -> what serves it, in the order DemoBuilder.py's targeting
    lists them: the fallthrough first, then each rule, the guarded rollout's
    two sides and the adaptive trigger's serve, in the order the spec has them.
    """
    served = {spec["fallthrough"]: ["fallthrough"]}
    for name, value in spec.items():
        if name == "rules":
            for number, (variation, clauses) in enumerate(value, start=1):
                served.setdefault(variation, []).append(
                    f"rule {number} ({' and '.join(clause_label(c) for c in clauses)})")
        elif name == "guarded_rollout":
            for side in ("control", "target"):
                served.setdefault(value[side], []).append(f"guarded rollout {side}")
        elif name == "adaptive_trigger":
            served.setdefault(value["serve"], []).append("adaptive trigger")
    return served


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


# LaunchDarkly's dataset upload screen showed a file with rows over about
# 4,096 characters as empty, so a row this long is warned about.
MAX_ROW_CHARS = 4000


def check_dataset(name):
    """Stop on rows that would spoil a run, before any model call; return the
    rows too long to show in LaunchDarkly's upload screen, as (line, length).

    Two rows with the same input and variables would count twice in pass
    rates, and their tool calls couldn't be told apart. Anything outside
    ASCII is written as a JSON escape, to be safe with the upload screen.
    """
    seen, long_rows = {}, []
    with open(os.path.join(HERE, "datasets", name), encoding="utf-8") as f:
        lines = f.read().splitlines()
    for number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        if not line.isascii():
            raise SystemExit(f"error: datasets/{name} line {number} has a character outside ASCII; "
                             "write it as a JSON escape, as json.dumps does by default")
        if len(line) >= MAX_ROW_CHARS:
            long_rows.append((number, len(line)))
        row = json.loads(line)
        key = json.dumps([row.get("input"), row.get("variables", {})], sort_keys=True)
        if key in seen:
            raise SystemExit(f"error: datasets/{name} lines {seen[key]} and {number} have the same input "
                             "and variables, so they'd count twice and their tool calls couldn't be told apart")
        seen[key] = number
    return long_rows


def long_rows_warning(long_rows):
    """The summary's warning for check_dataset's long rows: dataset name -> [(line, length)]."""
    if not any(long_rows.values()):
        return ""
    lines = ["", f"### Warning: rows of {MAX_ROW_CHARS:,} characters or more", "",
             "LaunchDarkly's dataset upload screen may show a file with rows this long as empty.", ""]
    for name, rows in long_rows.items():
        lines += [f"- `datasets/{name}` line {number}: {length:,} characters" for number, length in rows]
    return "\n".join(lines) + "\n"


def judges_for(target, spec):
    """The judges an entry runs: the ones attached to its config, then its own."""
    return spec.get("judges", []) + target.get("judges", [])


async def judge_thresholds(evals, judges):
    """evaluationMetricKey -> (judge key, threshold), since a judge call carries only the metric key."""
    thresholds = {}
    for judge in judges:
        config = await asyncio.to_thread(ld_get, f"projects/{evals.project_key}/ai-configs/{judge['judgeConfigKey']}")
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
    tools = swag_tools.eval_tools() if target.get("tools") == "swag-assistant" else []
    result.tools = [t.key for t in tools]
    judges = judges_for(target, spec)
    print(f"running {target['config']}/{variation_key} on {len(rows)} rows of {target['dataset']}"
          + (f" with tools {', '.join(result.tools)}" if tools else ""), flush=True)
    current = result
    try:
        thresholds = await judge_thresholds(evals, judges)
        run = await evals.run(
            key=result.key,
            dataset=rows,
            ai_config=AIConfig(key=target["config"], variation=variation_key),
            generation=generation_for(target, variation, args.replace or ()),
            # The SDK picks the handler by the config's mode: agent_handler
            # for AGENT_CONFIGS, the messages handler for the rest and for
            # every judge.
            handlers=[recording_handler(inner, result, rows, JUDGE_VIEWS.get(target["config"]), thresholds)
                      for inner in (create_langchain_messages_handler(bedrock_model), agent_handler(bedrock_model))],
            # These replace the variation's tools. Without an entry's tools
            # there are none: the store's Order Review agents call theirs
            # before they're handed on, and the other datasets carry what the
            # tools found.
            tools=tools,
            criteria=[Scorer(name=name, fn=SCORERS[name]) for name in target.get("scorers", [])]
            + (statement_scorers(target["statements"]) if "statements" in target else [])
            + [Judge(key=j["judgeConfigKey"], ground_truth_context=j.get("ground_truth"),
                     **({"threshold": j["threshold"]} if "threshold" in j else {}))
               for j in judges],
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
# optimization its statements come from, its dataset file and, for an entry
# with tools, the stand-ins and the store code they answer from.

def git(*args):
    return subprocess.run(["git", *args], cwd=HERE, capture_output=True, text=True)


def repo_path(name):
    top = git("rev-parse", "--show-toplevel").stdout.strip()
    return os.path.relpath(os.path.join(HERE, name), top)


def definition(resources, config, dataset, variation_key, dataset_text, tool_sources=None):
    configs = resources.get("AI_CONFIGS", []) + resources.get("AGENT_CONFIGS", [])
    spec = next((s for s in configs if s["config"]["config_key"] == config), None)
    target = next((t for t in resources.get("CI_EVALS", [])
                   if (t["config"], t["dataset"]) == (config, dataset)), None)
    if spec is None or target is None:
        return None
    # What serves the variation is part of it, so a variation that targeting
    # starts to serve is evaluated, though its own definition is unchanged.
    served_by = served_variations(spec).get(variation_key, [])
    judges = [next((s for s in configs if s["config"]["config_key"] == j["judgeConfigKey"]), None)
              for j in judges_for(target, spec)]
    optimization = next((o for o in resources.get("AGENT_OPTIMIZATIONS", [])
                         if o["key"] == target.get("statements")), None)
    return json.dumps({
        "target": target, "served_by": served_by,
        "variation": next((v for v in spec["variations"] if v["ai_config_version_key"] == variation_key), None),
        "judges": judges, "attached": spec.get("judges", []),
        "snippets": resources.get("PROMPT_SNIPPETS", []),
        "optimization": optimization, "dataset": dataset_text,
        "tool_sources": tool_sources if target.get("tools") else None,
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
    top = git("rev-parse", "--show-toplevel").stdout.strip()
    sources_now, sources_then = {}, {}
    for path in swag_tools.SOURCES:
        with open(os.path.join(top, path), encoding="utf-8") as f:
            sources_now[path] = f.read()
        shown = git("show", f"{base}:{path}")
        sources_then[path] = shown.stdout if shown.returncode == 0 else None
    changed = []
    for target, variation in pairs:
        name = os.path.join("datasets", target["dataset"])
        with open(os.path.join(HERE, name), encoding="utf-8") as f:
            now_text = f.read()
        then = git("show", f"{base}:{repo_path(name)}")
        now = definition(vars(demo_resources), target["config"], target["dataset"], variation, now_text,
                         sources_now)
        before = definition(base_resources, target["config"], target["dataset"], variation,
                            then.stdout if then.returncode == 0 else None, sources_then)
        if now != before:
            changed.append((target, variation))
    return changed, False


# ---- Compared with a baseline ----

def miss_key(miss):
    return (miss["row"], miss["expected"]) if isinstance(miss, dict) else (miss.row, miss.expected)


def comparison(results, baseline):
    """Markdown comparing each result with the baseline run of the same
    config, variation, mode and dataset, or None with no baseline at all."""
    if baseline is None:
        return None
    lines = ["", "### Compared with `main`", ""]
    for r in results:
        if r.error:
            continue
        then = next((b for b in baseline if (b["config"], b["variation"], b.get("mode"), b.get("dataset"))
                     == (r.config, r.variation, r.mode, r.dataset) and not b.get("error")), None)
        name = f"`{r.config}/{r.variation}`" + (" with tools" if r.tools else "")
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


def unevaluated_note(unevaluated):
    """The summary's list of variations targeting serves that a variations
    override left out: config -> {variation: what serves it}."""
    if not any(unevaluated.values()):
        return ""
    lines = ["", "### Served but not evaluated", "",
             "Targeting serves these, but the config's `variations` in `CI_EVALS` leaves them out.", ""]
    for config, served in unevaluated.items():
        lines += [f"- `{config}/{variation}`: {', '.join(by)}" for variation, by in served.items()]
    return "\n".join(lines) + "\n"


def markdown(results):
    lines = ["## Offline evals", "",
             "| Config | Variation | Served by | Tools | Dataset | Rows passed | Verdict | Run |",
             "|---|---|---|---|---|---|---|---|"]
    for r in results:
        if r.error:
            verdict, passed = f"error: {r.error[:150]}", "–"
        else:
            verdict = "passed" if r.passed else "failed"
            passed = f"{r.summary.get('passed', 0)}/{r.summary.get('total', r.rows)}"
            if r.summary.get("errors"):
                passed += f" ({r.summary['errors']} errors)"
        run = f"[{r.key}]({r.url})" if r.url else r.key
        served_by = ", ".join(r.served_by) or "not served by targeting"
        tools = ", ".join(f"`{t}`" for t in r.tools) or "none"
        lines.append(f"| `{r.config}` | `{r.variation}` | {served_by} | {tools} | `{r.dataset}` | {passed} | {verdict} "
                     f"| {run} |")
    for r in results:
        # A config can be run with tools and without, on different datasets.
        name = f"{r.config}/{r.variation}" + (" with tools" if r.tools else "")
        for judge, scores in r.judge_scores.items():
            lines.append(f"\n`{name}` {judge}: mean {sum(scores) / len(scores):.2f}, "
                         f"lowest {min(scores):.2f}, over {len(scores)} rows")
        if r.row_errors:
            lines += ["", f"**{name} row errors:**", ""]
            lines += [f"- `{e}`" for e in r.row_errors]
        if r.misses:
            lines += ["", f"<details><summary>{name}: {len(r.misses)} to look at</summary>", "",
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
    # What targeting serves, unless the entry's variations or --variation
    # says otherwise.
    served = {t["config"]: served_variations(spec_for(t["config"])) for t in targets}
    pairs = [(t, v) for t in targets
             for v in ([args.variation] if args.variation else t.get("variations", list(served[t["config"]])))]
    unevaluated = {}
    for t in targets:
        if "variations" in t and not args.variation:
            unevaluated[t["config"]] = {v: by for v, by in served[t["config"]].items() if v not in t["variations"]}
    note = unevaluated_note(unevaluated)
    if args.changed:
        pairs, everything = changed_since(args.changed, pairs)
        if everything:
            # The runner itself changed, so its result could differ for any
            # target: all of them, on their quick rows.
            args.quick = True
        if not pairs:
            write_summary("## Offline evals\n\nNo AI Config, judge, prompt snippet or dataset that CI "
                          f"evaluates changed since `{args.changed[:7]}`, so nothing was evaluated.\n" + note, args)
            for out in (args.json_out, args.baseline_out):
                if out:
                    with open(out, "w", encoding="utf-8") as f:
                        json.dump([] if out == args.json_out else load_baseline(args.baseline) or [], f)
            return 0
    long_rows = {name: check_dataset(name) for name in dict.fromkeys(t["dataset"] for t, _ in pairs)}
    warning = long_rows_warning(long_rows)
    if warning:
        print(warning, flush=True)
    baseline = load_baseline(args.baseline)
    evals = init_evaluations(project_key=os.environ["LD_PROJECT_KEY"], api_key=os.environ["LD_API_KEY"],
                             sdk_key=os.environ["LD_SDK_KEY"])
    results = []
    try:
        for target, variation in pairs:
            result = await run_target(evals, target, variation, args)
            result.served_by = served[target["config"]].get(variation, [])
            results.append(result)
    finally:
        await shutdown()
    text = markdown(results) + note + warning
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
        ran = {(r["config"], r["variation"], r["mode"], r["dataset"]) for r in saved if not r["error"]}
        kept = [b for b in baseline or []
                if (b["config"], b["variation"], b.get("mode"), b.get("dataset")) not in ran]
        with open(args.baseline_out, "w", encoding="utf-8") as f:
            json.dump(kept + [r for r in saved if not r["error"]], f, indent=2)
    return 1 if any(r.error for r in results) else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", action="append", help="only this config; repeat for more")
    parser.add_argument("--variation", help="this variation instead of the ones targeting serves")
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
