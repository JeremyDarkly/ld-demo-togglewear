/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1536px",
      },
    },
    extend: {
      // Mirrors the variable groups in Jen's Figma file (Demo-ToggleWear-2026)
      // so a token name in the design maps straight onto a class name here.
      // Namespaced as base-* / grays-* to avoid overwriting Tailwind's own
      // blue, lime, gray and black scales.
      colors: {
        base: {
          lime: "#DDFF46",
          blue: "#405BFF",
          orange: "#FF9D29",
          cyan: "#3DD6F5",
        },
        grays: {
          white: "#FFFFFF",
          "01": "#F8F8F8",
          "02": "#D1D6D9",
          "03": "#A7A9AC",
          "04": "#6D6E71",
          "05": "#414042",
          "black-01": "#101010",
          "ld-black": "#191919",
          // Gray 06 — the only published grey darker than LD Black's
          // neighbours. Jen uses it for the loyalty progress track on the
          // account page, where a hairline would vanish against the black.
          "06": "#2C2C2C",
          // The hairline Jen borders every cart card and input with, and the
          // fill behind the product detail galleries. Not a published
          // variable — it sits between White and Gray 02.
          hairline: "#E5E8E8",
        },
        // Not a published variable either. The cart is the only untokenized
        // screen in Jen's file, and this purple is the whole of its accent:
        // the checkout button, the loyalty discount row and the FREE shipping
        // value. Kept as drawn pending her review.
        accent: {
          purple: "#A34FDE",
        },
      },
      fontFamily: {
        // Sora and Geist are loaded through next/font in pages/_app.tsx.
        sora: ["var(--font-sora)", "sans-serif"],
        // Jen uses Geist SemiBold for two small uppercase labels: the NEW
        // badge on product cards and the swag assistant launcher. Unlike
        // Söhne it is openly licensed and served by next/font, so it needs
        // nothing from the design team.
        geist: ["var(--font-geist)", "Inter", "sans-serif"],
        // Söhne and Söhne Mono are local files loaded in pages/_app.tsx.
        sohne: [
          "var(--font-sohne)",
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        "sohne-mono": [
          "var(--font-sohne-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      // Letter-spacing in Figma is a percentage of font size; these are the
      // resolved pixel values.
      fontSize: {
        h1: ["64px", { lineHeight: "1", letterSpacing: "-3.2px" }],
        h2: ["56px", { lineHeight: "1.05", letterSpacing: "-2.8px" }],
        h3: ["40px", { lineHeight: "1.05", letterSpacing: "-2px" }],
        // Web H4 — the referral card headline on the account page. Söhne
        // rather than Sora, unlike the other headings.
        h4: ["32px", { lineHeight: "1.1", letterSpacing: "-0.64px" }],
        // Web H6 — the product detail price.
        h6: ["20px", { lineHeight: "1.15", letterSpacing: "-0.4px" }],
        main: ["16px", { lineHeight: "1.55", letterSpacing: "0" }],
        // Web Text Large, Medium — the Add to Cart / Wishlist buttons.
        "large-medium": ["18px", { lineHeight: "1.35", letterSpacing: "0" }],
        "main-medium": ["16px", { lineHeight: "1.55", letterSpacing: "-0.48px" }],
        small: ["14px", { lineHeight: "1.4", letterSpacing: "0" }],
        xsmall: ["12px", { lineHeight: "1.5", letterSpacing: "0" }],
        // Web Text Xsmall CAPS — the cart's uppercase field labels and its
        // small link actions. 12% tracking rather than the mono token's 3%.
        "xsmall-caps": ["12px", { lineHeight: "1.2", letterSpacing: "1.44px" }],
        "xsmall-mono": ["12px", { lineHeight: "1.5", letterSpacing: "0.36px" }],
      },

      // The search panel drops out from under the header rather than fading
      // in on the spot, so it reads as having come from the magnifying glass
      // it was opened with. Short and eased-out, because anything slower
      // feels like waiting.
      keyframes: {
        "drop-in": {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        // The chat header's variation badge lighting up in Base/Lime when
        // LaunchDarkly starts serving a different one, then settling back.
        // Long enough to catch the eye of someone watching the other screen.
        "badge-flash": {
          from: { backgroundColor: "rgba(221, 255, 70, 0.3)", color: "#FFFFFF" },
          to: { backgroundColor: "rgba(221, 255, 70, 0)" },
        },
      },
      animation: {
        "drop-in": "drop-in 180ms ease-out",
        "fade-in": "fade-in 180ms ease-out",
        "badge-flash": "badge-flash 1.6s ease-out",
      },
    },
  },
  plugins: [],
};
