import type { AppProps } from "next/app";
import { useRouter } from "next/router";
import { Sora, Geist } from "next/font/google";
import localFont from "next/font/local";
import { CartProvider } from "@/components/cart/CartProvider";
import { SavedItemsProvider } from "@/components/account/SavedItemsProvider";
import { OrderProvider } from "@/components/checkout/OrderProvider";
import { DeveloperToolbarProvider } from "@/components/ui/DeveloperToolbar";
import { IncidentProvider } from "@/components/ui/IncidentProvider";
import { ShopperProvider } from "@/components/ui/ShopperProvider";
import { SwagAssistantProvider } from "@/components/ui/SwagAssistantProvider";
import LaunchDarklyProvider from "@/components/ui/LaunchDarklyProvider";
import DemoGenerator from "@/components/generator/DemoGenerator";
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

// Söhne is licensed from Klim Type Foundry through the design team; only the
// weights the Tailwind classes use are here. Klim names them in German: Buch
// is 400, Kräftig 500, Halbfett 600 and Dreiviertelfett 700.
const sohne = localFont({
  src: [
    { path: "../styles/fonts/Sohne-Buch.woff2", weight: "400" },
    { path: "../styles/fonts/Sohne-Kraftig.woff2", weight: "500" },
    { path: "../styles/fonts/Sohne-Halbfett.woff2", weight: "600" },
    { path: "../styles/fonts/Sohne-Dreiviertelfett.woff2", weight: "700" },
  ],
  display: "swap",
});

const sohneMono = localFont({
  src: "../styles/fonts/SohneMono-Buch.woff2",
  weight: "400",
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
      {/* Söhne is the body font, set on <body> itself, and the dialogs portal
          into <body> outside this wrapper, so its variables go on :root
          rather than on the wrapper like Sora's and Geist's. */}
      <style jsx global>{`
        :root {
          --font-sohne: ${sohne.style.fontFamily};
          --font-sohne-mono: ${sohneMono.style.fontFamily};
        }
      `}</style>
      {/* Who is shopping, their cart, their wishlist and their placed order
          all have to outlive a page change, so they are owned above the page
          rather than by any one of them. */}
      <ShopperProvider>
        {/* Both above LaunchDarklyProvider, because the context it sends is
            built from the shopper's role and tier and from the cart's item
            count — that is what the segments and flag 08's rules target. */}
        <CartProvider>
          <LaunchDarklyProvider>
            <SavedItemsProvider>
              <OrderProvider>
                {/* Staged from the account menu and felt at checkout and in
                    search, so they outlive a page change like the cart does. */}
                <IncidentProvider>
                  {/* Switched on from the account menu, and open until it is
                      switched off again, whichever page that happens on. */}
                  <DeveloperToolbarProvider>
                    {/* The assistant's conversation outlives a page change
                        too, and the cart's help card opens it from outside
                        the corner of the screen it lives in. */}
                    <SwagAssistantProvider>
                      <div key={asPath} data-page-transition>
                        <Component {...pageProps} />
                      </div>
                      {/* Outside the keyed wrapper, so moving between pages
                          does not close it. */}
                      <DemoGenerator />
                    </SwagAssistantProvider>
                  </DeveloperToolbarProvider>
                </IncidentProvider>
              </OrderProvider>
            </SavedItemsProvider>
          </LaunchDarklyProvider>
        </CartProvider>
      </ShopperProvider>
    </div>
  );
}
