"""Runs code_checks.py over code_check_cases.json, the cases lib/codeChecks.ts
is tested against too (scripts/code-checks.test.mjs), and exits non-zero
when a check doesn't give a case's result or reasons.

    python check_code_checks.py

Standard library only: no AI SDK and no credentials.
"""

import json
import os
import sys

from code_checks import CHECKS

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    with open(os.path.join(HERE, "code_check_cases.json")) as f:
        cases = json.load(f)
    wrong = 0
    for case in cases:
        result = CHECKS[case["check"]](case["output"], **case["input"])
        if result.passed != case["passes"] or result.reasons != case["reasons"]:
            wrong += 1
            print(f"MISMATCH {case['check']}: {case['name']}\n"
                  f"  expected {'pass' if case['passes'] else 'fail'} {case['reasons']}\n"
                  f"  got      {'pass' if result.passed else 'fail'} {result.reasons}")
    checked = sorted({c["check"] for c in cases})
    print(f"{len(cases) - wrong} of {len(cases)} cases match, across {', '.join(checked)}.")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
