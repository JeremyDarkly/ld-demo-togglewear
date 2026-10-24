import { type ServedBy } from "@/lib/swagAssistant";

// The Smart Search AI Config's key. The search panel asks /api/smart-search
// for picks, and the config's adaptive trigger moves it to its fallback
// model when the custom event below climbs.
export const SMART_SEARCH_KEY = "smart-search";
export const SMART_SEARCH_FAILED_KEY = "smart-search-failed";

export type SmartSearchPick = {
  slug: string;
  // Left out when the model gave none, rather than shown empty.
  reason?: string;
};

// What /api/smart-search sends back. Null picks mean the config is off or
// LaunchDarkly is unreachable, and the panel shows no row at all. An empty
// list is the model finding nothing that fits, which also shows no row.
export type SmartSearchReply = {
  picks: SmartSearchPick[] | null;
  servedBy?: ServedBy;
};
