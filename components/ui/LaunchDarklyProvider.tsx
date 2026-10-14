import {
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  asyncWithLDProvider,
  useLDClient,
} from "launchdarkly-react-client-sdk";

import { useCart } from "@/components/cart/CartProvider";
import { useShopper } from "@/components/ui/ShopperProvider";
import { contextFor } from "@/lib/ldContext";
import { DEFAULT_SHOPPER_ID, shopperById } from "@/lib/shopper";

// The LaunchDarkly client, owned above the pages so navigating doesn't tear it
// down and re-initialise it.
//
// The client can only be built in the browser, so it is created in an effect
// and the tree renders without it on the server and on the first paint. That
// is safe because useFlags returns an empty object when there is no provider
// above it rather than throwing: every flag reads falsy for one frame and the
// real values replace them. bootstrap makes that frame invisible after the
// first visit by reusing the last values seen.
type ProviderComponent = ComponentType<{ children: ReactNode }>;

export default function LaunchDarklyProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [Provider, setProvider] = useState<ProviderComponent | null>(null);

  useEffect(() => {
    const clientSideID = process.env.NEXT_PUBLIC_LD_CLIENT_KEY;
    if (!clientSideID) {
      // Worth saying out loud, because the symptom otherwise is a storefront
      // that looks finished with every new feature silently switched off.
      console.warn(
        "NEXT_PUBLIC_LD_CLIENT_KEY is not set — every flag will read off",
      );
      return;
    }

    let cancelled = false;

    // Seeded with the default shopper rather than the current one:
    // ShopperProvider restores the saved selection in an effect of its own, so
    // on first render the real person isn't known yet. ShopperIdentity
    // re-identifies the moment it is, which is one extra evaluation at startup
    // and no flicker.
    const seed = shopperById(DEFAULT_SHOPPER_ID);

    asyncWithLDProvider({
      clientSideID,
      context: contextFor(seed, seed.role),
      reactOptions: { useCamelCaseFlagKeys: false },
      options: { bootstrap: "localStorage" },
    }).then((provider) => {
      if (!cancelled) setProvider(() => provider as ProviderComponent);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!Provider) return <>{children}</>;

  return (
    <Provider>
      <ShopperIdentity>{children}</ShopperIdentity>
    </Provider>
  );
}

// Pushes the switcher's choice into LaunchDarkly, which is the half that makes
// the segment rules mean anything: picking Chris re-identifies the context with
// role "developer", and that is what the Developers segment matches on. Picking
// Diane sends tier "platinum".
//
// The cart goes too, so emptying it takes the cart reminder banner away
// without a reload.
function ShopperIdentity({ children }: { children: ReactNode }) {
  const client = useLDClient();
  const { person, role } = useShopper();
  const { count, returning } = useCart();

  useEffect(() => {
    if (!client) return;
    client.identify(contextFor(person, role, { count, returning }));
  }, [client, person, role, count, returning]);

  return <>{children}</>;
}
