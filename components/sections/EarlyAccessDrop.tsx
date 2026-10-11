import SectionPanel from "@/components/layout/SectionPanel";
import ProductCard from "@/components/ui/ProductCard";
import Reveal from "@/components/ui/Reveal";
import { productBySlug, type PricingVariant, type Product } from "@/lib/products";

// The next drop, shown early to whoever flag 01 lets in — beta testers and
// developers. It is the demo's plainest release toggle, ToggleWear's version
// of core-demo's Wealth Management component: a whole section that is there
// for some shoppers, absent for the rest, and gone for everyone the moment
// the flag is switched off.
//
// Jen did not design it, so it is built from her pieces: the panel from the
// item block, the cards from best sellers, and lime, the brand's accent, as
// the panel's colour. Lime rather than the white of the panel below it so the
// two grids are not read as one, and rather than black because the hero
// directly above is black and the section would merge into it.
//
// The four are the newest pieces in the catalogue, the ones with photography,
// so nothing here waits on Jen. Members-only items are left out: early
// access and membership are separate entitlements, and Megan is not a member.
const EARLY_ACCESS_SLUGS = [
  "togglewear-hoodie",
  "togglewear-tee",
  "bucket-hat",
  "checkerboard-socks",
];

const products = EARLY_ACCESS_SLUGS.map(productBySlug).filter(
  (product): product is Product => Boolean(product),
);

export default function EarlyAccessDrop({
  variant = "default",
}: {
  variant?: PricingVariant;
}) {
  return (
    <SectionPanel className="bg-base-lime">
      <div className="px-6 pb-16 pt-12 md:px-10 md:pb-20 md:pt-16 xl:px-16 xl:pb-[100px] xl:pt-[75px]">
        <Reveal className="mb-12 flex flex-col gap-4">
          <p className="font-sohne-mono text-xsmall-mono uppercase text-grays-ld-black">
            Early access
          </p>
          <h2 className="font-sora text-h3 font-semibold text-grays-ld-black">
            The Fall drop, before everyone else.
          </h2>
          <p className="max-w-[620px] font-sohne text-main text-grays-ld-black/70">
            It opens to everyone soon. You are seeing it first because you are
            on the early access list.
          </p>
        </Reveal>

        <div className="grid grid-cols-2 gap-x-6 gap-y-12 xl:grid-cols-4">
          {products.map((product, index) => (
            <Reveal key={product.slug} delay={index * 80}>
              <ProductCard
                product={product}
                memberPricing={variant === "loyaltyGold"}
                badge="Early access"
              />
            </Reveal>
          ))}
        </div>
      </div>
    </SectionPanel>
  );
}
