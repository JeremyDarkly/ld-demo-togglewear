import type { NextApiRequest, NextApiResponse } from "next";
import { getClient } from "@launchdarkly/ai-node";
import { getAiClient, takeReply } from "@/lib/aiServer";
import { guard, LIMITS, text } from "@/lib/apiGuard";
import { contextFromRequest } from "@/lib/ldServer";

// A thumbs up or down on one of the swag assistant's replies, recorded on
// the AI Config run that wrote it. LaunchDarkly shows the two counts per
// variation on the config's Monitoring tab, beside the judges' scores, so
// what shoppers thought and what the judges thought can be read together.
// The 1.0 SDK has no feedback method, so the store sends the two events the
// legacy tracker did, on the run's own track data.
const KINDS: Record<string, string> = {
  positive: "$ld:ai:feedback:user:positive",
  negative: "$ld:ai:feedback:user:negative",
};

// Next refuses a bigger body with 413 before the handler runs.
export const config = { api: { bodyParser: { sizeLimit: "2kb" } } };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ ok: true } | { error: string }>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!guard(req, res, "feedback", LIMITS.feedback)) return;

  const kind = KINDS[req.body?.kind];
  const replyId = text(req.body?.replyId, 100);
  if (!kind || !replyId) {
    res.status(400).json({ error: "Send a replyId and a kind of positive or negative" });
    return;
  }

  // Unknown once the server restarts, or once the reply has been rated.
  const trackData = takeReply(replyId);
  const aiClient = await getAiClient();
  if (!trackData || !aiClient) {
    res.status(404).json({ error: "That reply can no longer be rated" });
    return;
  }

  getClient().track(kind, contextFromRequest(req.headers), trackData, 1);
  res.status(200).json({ ok: true });
}
