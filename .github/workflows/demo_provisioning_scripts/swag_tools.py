"""Stand-ins for the Swag Assistant's four tools, for ci_eval.py.

Each one answers by calling the store's real tool (lib/swagAssistantTools.ts)
through scripts/swag-tools.mjs on Node, so it can't drift from the store. The
tools are per shopper, and a tool only gets its arguments, so the shopper is
SHOPPER, which ci_eval.py sets from the row's metadata.shopper before the row
runs. Each row runs in its own task, so each sees its own.

    python swag_tools.py

is the parity check: it runs every call in the tools dataset and the Swag
Assistant dataset, plus searches with each argument, a bad slug and a guest,
through the stand-ins and through the real tools, and exits non-zero on any
difference. It needs Node 22.18 or later and nothing else: no credentials, no
npm install.
"""

import asyncio
import contextvars
import json
import os
import sys

from launchdarkly_ai_server import EvalTool

from demo_resources import AI_TOOLS

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
NODE = ["node", "--no-warnings", "--import", "./scripts/tool-call-errors-register.mjs", "scripts/swag-tools.mjs"]

TOOL_KEYS = ["search-products", "get-product-details", "get-member-perks", "get-order-status"]

# The stand-ins themselves, the Node loader the bridge runs under, and the
# store code they answer from: a change to any of them changes what a tool
# returns, so ci_eval.py --changed reruns the entry. The tools' schemas and
# descriptions are AI_TOOLS', which ci_eval.py's definition() carries.
SOURCES = [".github/workflows/demo_provisioning_scripts/swag_tools.py", "scripts/swag-tools.mjs",
           "scripts/tool-call-errors-register.mjs", "scripts/tool-call-errors-hooks.mjs",
           "lib/swagAssistantTools.ts", "lib/products.ts", "lib/account.ts", "lib/shopper.ts",
           "lib/sizeGuide.ts"]

SHOPPER = contextvars.ContextVar("swag_shopper", default=None)
# The row's calls as the stand-ins answered them, in full: the SDK cuts a
# long result short in what it shows the judges.
CALLS = contextvars.ContextVar("swag_calls", default=None)


async def call_real_tools(calls):
    """[{"shopper", "tool", "args"}] -> each one's {"output"} or {"error"}, from the real tools.

    Raises RuntimeError("swag tool bridge failed: ...") when the bridge
    itself fails: Node can't start, exits non-zero, or answers out of form.
    """
    try:
        process = await asyncio.create_subprocess_exec(
            *NODE, cwd=ROOT, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE)
        sent = "".join(json.dumps(c) + "\n" for c in calls).encode()
        stdout, stderr = await process.communicate(sent)
        replies = [json.loads(line) for line in stdout.decode().splitlines() if line.strip()]
    except (OSError, ValueError) as error:
        raise RuntimeError(f"swag tool bridge failed: {type(error).__name__}: {error}") from error
    if process.returncode or len(replies) != len(calls):
        raise RuntimeError(f"swag tool bridge failed: scripts/swag-tools.mjs exited {process.returncode} "
                           f"with {len(replies)} of {len(calls)} replies: {stderr.decode()[-300:]}")
    if not all(isinstance(r, dict) and ("output" in r or "error" in r) for r in replies):
        raise RuntimeError(f"swag tool bridge failed: a reply had neither output nor error: {stdout.decode()[:300]}")
    return replies


def stand_in(key):
    """The implementation ci_eval.py gives the SDK for one tool.

    The real tools' own error answers, such as a bad slug, come back as
    {"error"}, as the store hands them to the model. A failure of the bridge,
    or a row with no shopper, raises instead: that errors the row, and
    ci_eval.py lists it under row errors rather than scoring it.
    """

    async def call(arguments=None):
        shopper = SHOPPER.get()
        if not shopper:
            raise RuntimeError("ci_eval.py set no shopper for this row (metadata.shopper)")
        reply = (await call_real_tools([{"shopper": shopper, "tool": key, "args": arguments or {}}]))[0]
        output = reply["output"] if "output" in reply else {"error": reply["error"]}
        calls = CALLS.get()
        if calls is not None:
            calls.append((key, arguments or {}, output))
        return output

    return call


def eval_tools():
    """The four tools as inline EvalTools, with AI_TOOLS' schemas and descriptions."""
    specs = {t["tool_key"]: t for t in AI_TOOLS}
    return [EvalTool(key=key, implementation=stand_in(key), schema=specs[key]["schema"],
                     description=specs[key]["description"]) for key in TOOL_KEYS]


# ---- The parity check ----

def dataset_calls():
    """(shopper, tool, args) for every call the datasets name."""
    calls = []
    with open(os.path.join(HERE, "datasets", "swag_assistant.jsonl"), encoding="utf-8") as f:
        for row in map(json.loads, filter(str.strip, f)):
            for line in row["variables"]["tool_results"].split("\n"):
                if line.startswith("tool: "):
                    name, rest = line[len("tool: "):].split("(", 1)
                    args = json.JSONDecoder().raw_decode(rest)[0]
                    calls.append((row["metadata"]["shopper"], name, args))
    with open(os.path.join(HERE, "datasets", "swag_assistant_tools.jsonl"), encoding="utf-8") as f:
        for row in map(json.loads, filter(str.strip, f)):
            for call in json.loads(row["variables"]["expected_tools"]):
                calls.append((row["metadata"]["shopper"], call["name"], call.get("arguments", {})))
    return calls


SHOPPERS = ["guest", "alex-rivera", "diane-whitaker", "megan-caldwell", "chris-donovan"]

EXTRA_CALLS = [
    *[(shopper, tool, {}) for shopper in SHOPPERS for tool in TOOL_KEYS if tool != "get-product-details"],
    ("guest", "search-products", {"query": "warm hoodie for winter"}),
    ("alex-rivera", "search-products", {"query": "hoodies", "sort_by": "price_low_to_high"}),
    ("chris-donovan", "search-products", {"category": "Tech"}),
    ("megan-caldwell", "search-products", {"query": "headphones", "category": "Accessories"}),
    ("diane-whitaker", "search-products", {"max_price_usd": 25, "sort_by": "price_high_to_low"}),
    ("guest", "search-products", {"new_only": True, "category": "Apparel"}),
    ("alex-rivera", "get-product-details", {"slug": "togglewear-crewneck"}),
    ("guest", "get-product-details", {"slug": "togglewear-crewneck"}),
    ("chris-donovan", "get-product-details", {"slug": "no-such-product"}),
    ("guest", "get-product-details", {}),
]


async def parity():
    calls = list(dict.fromkeys(json.dumps(c, sort_keys=True) for c in dataset_calls() + EXTRA_CALLS))
    calls = [json.loads(c) for c in calls]
    real = await call_real_tools([{"shopper": s, "tool": t, "args": a} for s, t, a in calls])

    # Each in its own task, as each row is, a few at a time.
    slots = asyncio.Semaphore(8)

    async def through_stand_in(shopper, tool, args):
        async with slots:
            SHOPPER.set(shopper)
            return await stand_in(tool)(args)

    tasks = [asyncio.create_task(through_stand_in(*c)) for c in calls]
    got = await asyncio.gather(*tasks)
    differences = []
    for (shopper, tool, args), want, have in zip(calls, real, got):
        if "output" not in want or want["output"] != have:
            differences.append(f"{shopper} {tool}({json.dumps(args)}): real {json.dumps(want)[:200]}, "
                               f"stand-in {json.dumps(have)[:200]}")
    for d in differences:
        print(d, file=sys.stderr)
    if differences:
        print(f"{len(differences)} of {len(calls)} calls differ between the stand-ins and the real tools.",
              file=sys.stderr)
        return 1
    print(f"All {len(calls)} calls match between the stand-ins and the real tools.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(parity()))
