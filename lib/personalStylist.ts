import { ordersFor } from "@/lib/account";
import { productsFor, type Product } from "@/lib/products";
import { type Person, variantFor } from "@/lib/shopper";
import type { ServedBy } from "@/lib/swagAssistant";

// The Personal Stylist AI Config's key. The product page asks
// /api/personal-stylist for a note, and the demo generator plays the
// guarded rollout from one of its models to the other on the same config.
export const PERSONAL_STYLIST_KEY = "personal-stylist";

// What /api/personal-stylist sends back. A null note means the config is off
// or LaunchDarkly is unreachable, and the product page shows no card at all:
// unlike the chat, there is no scripted stand-in for a stylist.
export type StylistNote = {
  text: string;
  // The size the stylist picked, which the page selects for the shopper.
  // Absent for a one-size item, or a size the product does not come in.
  size?: string;
  // The slug of one other product to go with it, shown as a card the
  // shopper can add. Absent when the model named nothing in the catalog.
  pairing?: string;
  // For thumbs, which pages/api/personal-stylist/feedback.ts records on the
  // run that wrote the note.
  replyId: string;
  servedBy: ServedBy;
};

export type StylistReply = { note: StylistNote | null };

// What the stylist may pair a product with: the rest of this shopper's
// catalogue, members-only drop included for a member, less anything they
// have already ordered, since a pairing is something to add to the cart.
// No prices, which the note is told never to mention. Shared with the
// dataset the playground runs on, so both are given the same list.
export function stylistCatalogFor(person: Person, productSlug: string) {
  const ordered = new Set(ordersFor(person).flatMap((order) => order.lines.map((l) => l.slug)));
  return productsFor(variantFor(person.tier))
    .filter((p: Product) => p.slug !== productSlug && !ordered.has(p.slug))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      description: p.description,
    }));
}
