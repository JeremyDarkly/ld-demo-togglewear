import type { AppProps } from "next/app";
import { useRouter } from "next/router";
import { Sora, Geist } from "next/font/google";
import { CartProvider } from "@/components/cart/CartProvider";
import { SavedItemsProvider } from "@/components/account/SavedItemsProvider";
import { OrderProvider } from "@/components/checkout/OrderProvider";
import { ShopperProvider } from "@/components/ui/ShopperProvider";
import { SwagAssistantProvider } from "@/components/ui/SwagAssistantProvider";
import LaunchDarklyProvider from "@/components/ui/LaunchDarklyProvider";
import "@/styles/globals.css";

// next/font is only allowed in _app, not _document, so the CSS variable the
// Tailwind theme references is defined on a wrapper here.
const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-sora",
  display: "swap",
});

// Only SemiBold is used, on the NEW badge and the swag assistant launcher.
const geist = Geist({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-geist",
  display: "swap",
});

export default function App({ Component, pageProps }: AppProps) {
  // Keyed on the full path so the fade replays on every navigation, including
  // one that stays on the same page and only changes the category in the
  // query. Without a key React keeps the markup it already has and the new
  // page simply snaps into place.
  const { asPath } = useRouter();

  return (
    <div className={`${sora.variable} ${geist.variable}`}>
      {/* Who is shopping, their cart, their wishlist and their placed order
          all have to outlive a page change, so they are owned above the page
          rather than by any one of them. */}
      <ShopperProvider>
        {/* Both above LaunchDarklyProvider, because the context it sends is
            built from the shopper's role and tier and from the cart's item
            count — that is what the segments and flag 07's rules target. */}
        <CartProvider>
          <LaunchDarklyProvider>
            <SavedItemsProvider>
              <OrderProvider>
                {/* The assistant's conversation outlives a page change too,
                    and the cart's help card opens it from outside the corner
                    of the screen it lives in. */}
                <SwagAssistantProvider>
                  <div key={asPath} data-page-transition>
                    <Component {...pageProps} />
                  </div>
                </SwagAssistantProvider>
              </OrderProvider>
            </SavedItemsProvider>
          </LaunchDarklyProvider>
        </CartProvider>
      </ShopperProvider>
    </div>
  );
}
