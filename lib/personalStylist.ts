import { type ServedBy } from "@/lib/swagAssistant";

// The Personal Stylist AI Config's key. The product page asks
// /api/personal-stylist for a note, and the demo generator plays the
// guarded rollout from one of its models to the other on the same config.
export const PERSONAL_STYLIST_KEY = "personal-stylist";

// What /api/personal-stylist sends back. A null note means the config is off
// or LaunchDarkly is unreachable, and the product page shows no card at all:
// unlike the chat, there is no scripted stand-in for a stylist.
export type StylistNote = {
  text: string;
  // For thumbs, which pages/api/personal-stylist/feedback.ts records on the
  // run that wrote the note.
  replyId: string;
  servedBy: ServedBy;
};

export type StylistReply = { note: StylistNote | null };
