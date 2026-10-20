import type { NextApiRequest, NextApiResponse } from "next";
import { LDFeedbackKind } from "@launchdarkly/server-sdk-ai";
import { getAiClient, takeReply } from "@/lib/aiServer";
import { contextFromRequest } from "@/lib/ldServer";

// A thumbs up or down on one of the swag assistant's replies, recorded on
// the AI Config run that wrote it. LaunchDarkly shows the two counts per
// variation on the config's Monitoring tab, beside the judges' scores, so
// what shoppers thought and what the judges thought can be read together.
const KINDS: Record<string, LDFeedbackKind> = {
  positive: LDFeedbackKind.Positive,
  negative: LDFeedbackKind.Negative,
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ ok: true } | { error: string }>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const kind = KINDS[req.body?.kind];
  const replyId = req.body?.replyId;
  if (!kind || typeof replyId !== "string") {
    res.status(400).json({ error: "Send a replyId and a kind of positive or negative" });
    return;
  }

  // Unknown once the server restarts, or once the reply has been rated.
  const token = takeReply(replyId);
  const aiClient = await getAiClient();
  if (!token || !aiClient) {
    res.status(404).json({ error: "That reply can no longer be rated" });
    return;
  }

  aiClient
    .createTracker(token, contextFromRequest(req.headers))
    .trackFeedback({ kind });
  res.status(200).json({ ok: true });
}
