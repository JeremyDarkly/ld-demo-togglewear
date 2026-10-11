import { ROLES, TIER_LABELS, isNewCustomer, type Person } from "@/lib/shopper";

// What sets a shopper apart, as coloured tags, so the right person can be
// found in a list by colour without reading. Only the attributes that make
// someone different get a tag: "no tier" and the plain shopper role are what
// everyone has, and spelling them out on every row is what buried the one
// word that mattered.
//
// Colours come from the site's own palette, which has no gold or silver.
// Orange is the nearest to gold, and Platinum takes LD Black as the top rung.
// Beta borrows the cart's purple, the one accent outside the base set.
// Lime is avoided because the rows these sit in turn lime on hover.
const TONES = {
  platinum: "bg-grays-ld-black text-grays-white",
  gold: "bg-base-orange text-grays-ld-black",
  beta: "bg-accent-purple text-grays-white",
  developer: "bg-base-blue text-grays-white",
  plain: "border border-grays-ld-black/30 text-grays-ld-black",
} as const;

function tagsFor(person: Person) {
  const tags: { label: string; tone: keyof typeof TONES }[] = [];
  if (person.tier !== "none") {
    tags.push({ label: TIER_LABELS[person.tier], tone: person.tier });
  }
  if (person.role !== "shopper") {
    tags.push({
      label: ROLES.find((r) => r.id === person.role)?.label ?? person.role,
      tone: person.role,
    });
  }
  if (isNewCustomer(person)) {
    tags.push({ label: "New customer", tone: "plain" });
  }
  if (tags.length === 0) {
    tags.push({ label: "Shopper", tone: "plain" });
  }
  return tags;
}

export default function ShopperTags({ person }: { person: Person }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {tagsFor(person).map((tag) => (
        <span
          key={tag.label}
          className={`rounded-[2px] px-1.5 py-0.5 font-geist text-[9px] font-semibold uppercase leading-none tracking-[0.8px] ${TONES[tag.tone]}`}
        >
          {tag.label}
        </span>
      ))}
    </span>
  );
}
