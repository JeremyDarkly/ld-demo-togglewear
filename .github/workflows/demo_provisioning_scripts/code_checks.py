"""The deterministic checks behind ci_eval.py's scorers, as pure functions.

Each takes plain fields and the answer, and returns a CheckResult: a score of
1.0 or 0.0, and the problems it found. A check looks for what is wrong, so an
answer with nothing it can check passes.

lib/codeChecks.ts runs the same checks on the store's live replies, and
code_check_cases.json is the cases both are tested against
(check_code_checks.py here, scripts/check-code-checks.mjs there). A change to
one is a change to the other, and to the cases.

No imports beyond the standard library, so the cases run without the AI SDK.
"""

import json
import re
from dataclasses import dataclass, field


@dataclass
class CheckResult:
    score: float
    # What it found wrong. A check can list a problem and still pass, as a
    # wrong total with the right decision does.
    reasons: list = field(default_factory=list)

    @property
    def passed(self):
        return self.score >= 1.0


def parse_json_with_possible_fences(raw_text):
    """The AI SDK's parser of the same name (launchdarkly_ai_server), copied so
    the checks don't need the SDK. JSON, JSON in a ``` fence, or JSON in a
    fence after a preamble; None when none of those parse."""
    trimmed = raw_text.strip()
    try:
        return json.loads(trimmed)
    except (json.JSONDecodeError, ValueError):
        pass
    stripped = re.sub(r"^```json\r?\n", "", trimmed)
    stripped = re.sub(r"^```\r?\n", "", stripped)
    stripped = re.sub(r"\r?\n```$", "", stripped)
    stripped = stripped.strip()
    try:
        return json.loads(stripped)
    except (json.JSONDecodeError, ValueError):
        pass
    fence_match = re.search(r"```(?:json)?\r?\n([\s\S]*?)\r?\n```", trimmed)
    if fence_match:
        try:
            return json.loads(fence_match.group(1).strip())
        except (json.JSONDecodeError, ValueError):
            pass
    return None


def answer_of(output):
    """The answer filled in to output_format, as a dict, or None.

    It may come as JSON text, which the model may put in a fence.
    """
    if isinstance(output, dict):
        return output
    answer = parse_json_with_possible_fences(output) if isinstance(output, str) else None
    return answer if isinstance(answer, dict) else None


def decision_matches_points(output, expected_decision, risk_points):
    """Passes when the decision is the one the risk points call for.

    The store acts on the decision alone (parseDecision in
    pages/api/order-review/index.ts), so a wrong total with the right decision
    passes, but is listed.
    """
    answer = answer_of(output) or {}
    decision, score = answer.get("decision"), answer.get("score")
    reasons = []
    if not answer:
        reasons.append("no decision")
    else:
        if decision != expected_decision:
            reasons.append(f"decision {decision!r} isn't {expected_decision!r}")
        if score != risk_points:
            reasons.append(f"score {score!r} isn't {risk_points!r} points")
    return CheckResult(1.0 if decision == expected_decision else 0.0, reasons)


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


def stylist_reply_usable(output, sizes, catalog):
    """Passes when the page can use the whole reply: a note, a pairing from
    the catalog it was given (a list of slugs), and a size the product comes in.

    The page drops a size or a pairing it can't use and keeps the note, so a
    reply that fails here still shows, with part of it missing.
    """
    reply = stylist_reply(output)
    problems = []
    # Over 50 words is listed, but the page still shows it, so only the
    # other problems fail the check.
    failed = False
    if reply is None:
        problems.append("not JSON")
        failed = True
    else:
        note = reply.get("note")
        if not isinstance(note, str) or not note.strip():
            problems.append("no note")
            failed = True
        elif len(note.split()) > 50:
            problems.append(f"note is {len(note.split())} words")
        # A list or an object is never a slug or a size, as in TypeScript.
        pairing = reply.get("pairing")
        if not isinstance(pairing, str) or pairing not in catalog:
            problems.append(f"pairing {pairing!r} isn't in its catalog")
            failed = True
        size = reply.get("size")
        if len(sizes) > 1 and (not isinstance(size, str) or size not in sizes):
            problems.append(f"size {size!r} isn't one of {', '.join(sizes)}")
            failed = True
    return CheckResult(0.0 if failed else 1.0, problems)


SIGNAL_POINTS = re.compile(r"with (\d+) points")
SENTENCE_END = re.compile(r"[.!?](?:\s|$)")


def case_note_covers_the_case(output, expected_decision, signal_points):
    """Passes when the note does what the Case Note prompt asks that code can
    check: three or four sentences, the decision, each signal's points, and
    plain text.

    Whether it gets the account history right and invents nothing is left to
    the acceptance statements.
    """
    note = output if isinstance(output, str) else json.dumps(output)
    problems = []
    # Order numbers and prices don't end a sentence, so a full stop counts
    # only before a space or the end.
    sentences = len(SENTENCE_END.findall(note.strip()))
    if not 3 <= sentences <= 4:
        problems.append(f"{sentences} sentences")
    said = {"review": ("held", "review"), "decline": ("declin",)}.get(expected_decision, ())
    if said and not any(word in note.lower() for word in said):
        problems.append(f"doesn't say it was {'held' if expected_decision == 'review' else 'declined'}")
    for points in sorted({str(p) for p in signal_points}):
        if points not in note:
            problems.append(f"no {points}-point signal")
    if re.search(r"(^|\n)\s*([-*#]|\d+\.)\s|\*\*", note):
        problems.append("markdown")
    return CheckResult(0.0 if problems else 1.0, problems)


# The word a summary has to contain for each decision.
DECISION_WORDS = {"approve": "approve", "review": "review", "decline": "declin"}


def demo_summary_names_decision(output):
    """Passes when the decision's summary contains the decision's word.

    Deliberately weak, a proxy for "the shopper is told the outcome": a wrong
    decision whose summary names that wrong decision passes it, and a right
    one put another way ("we've held your order") fails it. It runs live
    only, as a metric to compare with the stronger checks.
    """
    answer = answer_of(output) or {}
    word = DECISION_WORDS.get(answer.get("decision")) if isinstance(answer.get("decision"), str) else None
    summary = answer.get("summary")
    if word is None or not isinstance(summary, str):
        return CheckResult(1.0)
    if word in summary.lower():
        return CheckResult(1.0)
    return CheckResult(0.0, [f"summary doesn't say {word!r}"])


CHECKS = {
    "decision-matches-points": decision_matches_points,
    "stylist-reply-usable": stylist_reply_usable,
    "case-note-covers-the-case": case_note_covers_the_case,
    "demo-summary-names-decision": demo_summary_names_decision,
}
