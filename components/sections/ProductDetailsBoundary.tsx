import { Component, type ErrorInfo, type ReactNode } from "react";
import Link from "next/link";
import { LDObserve } from "@launchdarkly/observability";
import SectionPanel from "@/components/layout/SectionPanel";
import type { Product } from "@/lib/products";

// Catches a product panel that fails to render, so one broken product costs
// the shopper that panel rather than the whole page, and so the error reaches
// LaunchDarkly. React does not let an error it has caught reach the window,
// which is where the observability plugin listens for uncaught ones, so it is
// recorded here by hand. The error itself is the one React caught, untouched:
// its stack trace is what leads an engineer to the line that broke.
//
// The page renders this with key={product.slug}, so moving to another product
// starts with a clean slate instead of carrying the last product's failure.
type Props = { product: Product; flushBottom?: boolean; children: ReactNode };

export default class ProductDetailsBoundary extends Component<
  Props,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const { product } = this.props;
    LDObserve.recordError(error, "Product details failed to render", {
      component: "ProductDetails",
      "product.slug": product.slug,
      "product.category": product.category,
      componentStack: info.componentStack ?? "",
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <ProductUnavailable
        flushBottom={this.props.flushBottom}
        title="We couldn't load this product"
        body="Something went wrong on our end. Try again in a little while, or keep browsing in the meantime."
      />
    );
  }
}

// What stands in for the product panel when it cannot be shown. The page
// uses it too, for a catalog that timed out rather than one that crashed.
export function ProductUnavailable({
  title,
  body,
  flushBottom,
}: {
  title: string;
  body: string;
  flushBottom?: boolean;
}) {
  return (
    <SectionPanel
      flushBottom={flushBottom}
      className="bg-grays-white flex flex-col items-start gap-6 px-6 py-24 md:px-10 xl:px-16"
    >
      <h1 className="font-sora text-h4 font-semibold text-grays-ld-black">
        {title}
      </h1>
      <p className="max-w-[560px] font-sohne text-main text-grays-04">{body}</p>
      <Link
        href="/products"
        className="rounded-[2px] bg-grays-ld-black px-8 py-[18px] font-sohne text-large-medium font-medium text-grays-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-ld-black focus-visible:ring-offset-2"
      >
        Browse all products
      </Link>
    </SectionPanel>
  );
}
