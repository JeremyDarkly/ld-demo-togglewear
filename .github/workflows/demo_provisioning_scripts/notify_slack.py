"""notify_slack — tells the demo's owner in Slack how their build went.

People start a Create or Rebuild in the Demo Hub and wander off, so this DMs
them from the ToggleWear Slack app when it finishes: ready, up but missing
part of the LaunchDarkly project, or failed. The workflows run it as their
last job.

It never fails a build. With no SLACK_BOT_TOKEN, or no Slack account for the
owner, it says so and stops.

Reads from the environment:
    SLACK_BOT_TOKEN   the app's bot token (xoxb-), a repository secret
    DEMO_USER         the owner, the email before the @
    BUILD             "create" or "rebuild"
    RESULT            the build job's result: success, failure, skipped...
    CHECK             the outcome of its "Check everything was built" step

Only the standard library, so the job needs no install step.
"""

import json
import os
import urllib.parse
import urllib.request

SLACK = "https://slack.com/api/"
DEMO_HUB = "https://mydemo.launchdarklydemos.com"
# #ask-demo-engineering. Slack shows a channel mention by its current name.
HELP_CHANNEL = "C02G6QKME0L"


def slack(method, token, **fields):
    req = urllib.request.Request(
        SLACK + method,
        data=json.dumps(fields).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.load(res)


def lookup(token, email):
    # users.lookupByEmail takes form fields, not JSON.
    req = urllib.request.Request(
        SLACK + "users.lookupByEmail",
        data=urllib.parse.urlencode({"email": email}).encode(),
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.load(res)


def button(text, url, primary=False):
    b = {"type": "button", "text": {"type": "plain_text", "text": text}, "url": url}
    if primary:
        b["style"] = "primary"
    return b


def message(name, build, outcome):
    store = f"https://{name}-togglewear.launchdarklydemos.com"
    project = (
        f"https://app.launchdarkly.com/projects/{name}-togglewear/flags"
        "?env=production&selected-env=production"
    )
    built = "built" if build == "create" else "rebuilt"
    ask = f"ask in <#{HELP_CHANNEL}> and we'll help."

    if outcome == "ready":
        text = "Your ToggleWear store is ready."
        body = (
            f":white_check_mark: *Your ToggleWear store is ready.*\n"
            f"Your store and its LaunchDarkly project are {built} and good to go."
        )
        buttons = [
            button("Open store", store, primary=True),
            button("LaunchDarkly project", project),
        ]
    elif outcome == "incomplete":
        text = "Your ToggleWear store is up, but part of your LaunchDarkly project didn't build."
        body = (
            f":warning: *Your ToggleWear store is up, but part of your "
            f"LaunchDarkly project didn't build.*\n"
            f"Everything else works. A rebuild from the Demo Hub usually fills "
            f"in what's missing. If it happens again, {ask}"
        )
        buttons = [
            button("Open store", store),
            button("Demo Hub", DEMO_HUB, primary=True),
        ]
    else:
        text = "Your ToggleWear store didn't finish building."
        body = (
            f":x: *Your ToggleWear store didn't finish building.*\n"
            f"Please try again from the Demo Hub. If it fails again, {ask}"
        )
        buttons = [button("Demo Hub", DEMO_HUB, primary=True)]

    blocks = [
        {"type": "section", "text": {"type": "mrkdwn", "text": body}},
        {"type": "actions", "elements": buttons},
        {
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": f"ToggleWear · `{name}-togglewear`"}
            ],
        },
    ]
    return text, blocks


def outcome_of(result, check):
    if result == "success":
        return "ready"
    # The check runs last, after the store is online, so a build that failed
    # there and nowhere else left a working store.
    if result == "failure" and check == "failure":
        return "incomplete"
    return "failed"


def main():
    token = os.getenv("SLACK_BOT_TOKEN")
    name = os.getenv("DEMO_USER")
    if not token:
        print("No SLACK_BOT_TOKEN set, so no Slack message.")
        return
    if not name:
        print("No DEMO_USER, so no one to tell.")
        return

    outcome = outcome_of(os.getenv("RESULT", ""), os.getenv("CHECK", ""))
    # The same address DemoBuilder adds to the project as its owner.
    user = lookup(token, f"{name}@launchdarkly.com")
    if not user.get("ok"):
        print(f"Couldn't find {name} in Slack ({user.get('error')}), so no message.")
        return

    text, blocks = message(name, os.getenv("BUILD", "rebuild"), outcome)
    # Posting to a user ID opens the DM with the app.
    sent = slack("chat.postMessage", token, channel=user["user"]["id"], text=text, blocks=blocks)
    if sent.get("ok"):
        print(f"Told {name} in Slack: {outcome}.")
    else:
        print(f"Slack didn't take the message ({sent.get('error')}).")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 — a Slack hiccup must not fail the build
        print(f"Couldn't send the Slack message: {e}")
