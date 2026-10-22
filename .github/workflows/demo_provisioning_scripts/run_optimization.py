"""Run one of AGENT_OPTIMIZATIONS for real and save its results.

    python run_optimization.py order-decision-cost

Runs the optimization already in the project in .env with LaunchDarkly's
optimizer (pip install launchdarkly-ai-optimizer boto3 python-dotenv), the
agent and its judges on Bedrock with your AWS credentials. Everything the
optimizer records in LaunchDarkly is also written to
optimizations/<key>.json, which DemoBuilder replays into a new environment.
Run it again whenever the agent's instructions or its dataset change.
"""

import asyncio
import json
import os
import sys

import boto3
import ldclient
from dotenv import load_dotenv
from ldai.client import LDAIClient
from ldai.tracker import TokenUsage
from ldai_optimizer import OptimizationClient, OptimizationFromConfigOptions, OptimizationResponse
from ldai_optimizer.ld_api_client import LDApiClient
from ldclient import Context
from ldclient.config import Config

HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, "..", "..", "..", ".env"))
os.environ["LAUNCHDARKLY_API_KEY"] = os.environ["LD_API_KEY"]

# The Order Decision agent answers by filling this in, as it does at
# checkout (DECISION_SCHEMA in pages/api/order-review/index.ts).
DECISION_TOOL = {
    "name": "record_decision",
    "description": "Record the decision on the order.",
    "inputSchema": {"json": {
        "type": "object",
        "properties": {
            "decision": {"type": "string", "enum": ["approve", "review", "decline"]},
            "score": {"type": "number", "description": "The total risk points, at most 100."},
            "summary": {"type": "string",
                        "description": "One or two sentences to the shopper, shown at checkout."},
        },
        "required": ["decision", "score", "summary"],
    }},
}
STRUCTURED_AGENTS = {"fraud-decision-agent": DECISION_TOOL}

bedrock = boto3.client("bedrock-runtime")


def converse(model, system, user, parameters, tool=None):
    parameters = parameters or {}
    request = {
        "modelId": model,
        "messages": [{"role": "user", "content": [{"text": user}]}],
        "inferenceConfig": {
            "maxTokens": int(parameters.get("maxTokens") or parameters.get("max_tokens") or 1000),
            "temperature": float(parameters.get("temperature", 0)),
        },
    }
    if system:
        request["system"] = [{"text": system}]
    if tool:
        request["toolConfig"] = {"tools": [{"toolSpec": tool}],
                                 "toolChoice": {"tool": {"name": tool["name"]}}}
    response = bedrock.converse(**request)
    content = response["output"]["message"]["content"]
    used = next((c["toolUse"]["input"] for c in content if "toolUse" in c), None)
    text = json.dumps(used) if used is not None else "".join(c.get("text", "") for c in content)
    usage = response["usage"]
    return OptimizationResponse(output=text, usage=TokenUsage(
        total=usage["totalTokens"], input=usage["inputTokens"], output=usage["outputTokens"]))


async def handle_agent_call(key, config, context, is_evaluation):
    # With no user input, the instructions are the optimizer asking for the
    # next variation, which has to come back as one long JSON object.
    if context.user_input is None:
        return await asyncio.to_thread(
            converse, config.model.name, None, config.instructions,
            {"temperature": 0.1, "maxTokens": 4000})
    parameters = {name: config.model.get_parameter(name)
                  for name in ("maxTokens", "max_tokens", "temperature")
                  if config.model.get_parameter(name) is not None}
    return await asyncio.to_thread(
        converse, config.model.name, config.instructions, context.user_input,
        parameters, STRUCTURED_AGENTS.get(key))


async def handle_judge_call(key, config, context, is_evaluation):
    system = "\n\n".join(m.content for m in config.messages if m.role == "system")
    user = "\n\n".join(m.content for m in config.messages if m.role == "user")
    return await asyncio.to_thread(converse, config.model.name, system, user, {"maxTokens": 1000})


def record_results(events):
    """Keep a copy of every result the optimizer saves, in order."""
    post, patch = LDApiClient.post_agent_optimization_result, LDApiClient.patch_agent_optimization_result
    refs = {}

    def recording_post(self, project_key, optimization_key, payload):
        result_id = post(self, project_key, optimization_key, payload)
        refs[result_id] = len(refs)
        events.append({"op": "post", "ref": refs[result_id], "payload": dict(payload)})
        return result_id

    def recording_patch(self, project_key, optimization_key, result_id, payload):
        events.append({"op": "patch", "ref": refs.get(result_id), "payload": dict(payload)})
        return patch(self, project_key, optimization_key, result_id, payload)

    LDApiClient.post_agent_optimization_result = recording_post
    LDApiClient.patch_agent_optimization_result = recording_patch


async def main(key):
    events, outcome = [], {"passed": False}
    record_results(events)
    ldclient.set_config(Config(os.environ["LD_SDK_KEY"]))
    try:
        await OptimizationClient(LDAIClient(ldclient.get())).optimize_from_config(
            key, OptimizationFromConfigOptions(
                project_key=os.environ["LD_PROJECT_KEY"],
                handle_agent_call=handle_agent_call,
                handle_judge_call=handle_judge_call,
                context_choices=[Context.builder("agent-optimization").name("Agent Optimization").build()],
                on_passing_result=lambda context: outcome.update(passed=True),
                auto_commit=False,
            ))
    finally:
        ldclient.get().close()
    os.makedirs(os.path.join(HERE, "optimizations"), exist_ok=True)
    with open(os.path.join(HERE, "optimizations", f"{key}.json"), "w") as f:
        json.dump(events, f, indent=2)
    print(f"{key}: {len(events)} results saved; {'passed' if outcome['passed'] else 'did not pass'}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
