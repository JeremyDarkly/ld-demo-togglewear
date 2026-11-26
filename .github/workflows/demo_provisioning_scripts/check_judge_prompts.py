"""Exits non-zero when a judge in demo_resources.py has a variation whose
prompt lacks {{message_history}}.

The 1.0 AI SDK hands a judge the conversation, the reply and the JSON format
it must answer in only through that placeholder (see _JUDGE_HISTORY in
demo_resources.py). A judge without it never sees what it scores, answers in
prose, and scores nothing, with no error: only judge-parse-error shows it.

    python check_judge_prompts.py

Standard library only: no AI SDK and no credentials.
"""

import sys

from demo_resources import AGENT_CONFIGS, AI_CONFIGS

PLACEHOLDER = "{{message_history}}"


def main():
    judges = [s for s in AI_CONFIGS + AGENT_CONFIGS if s["config"].get("mode") == "judge"]
    checked = 0
    missing = []
    for spec in judges:
        for variation in spec["variations"]:
            checked += 1
            prompt = "".join(m.get("content", "") for m in variation.get("messages", []))
            if PLACEHOLDER not in prompt:
                missing.append(f"{spec['config']['config_key']} / {variation['ai_config_version_key']}")
    for name in missing:
        print(f"MISSING {PLACEHOLDER}: {name}")
    if not checked:
        print("No judge variations found in demo_resources.py.")
        return 1
    print(f"{checked - len(missing)} of {checked} judge variations, across {len(judges)} judges, "
          f"have {PLACEHOLDER}.")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
