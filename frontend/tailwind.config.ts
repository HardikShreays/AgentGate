import type { Config } from "tailwindcss";

// Design tokens — redesigned to sit inside Razorpay's own visual language.
// Razorpay's brand is a deep institutional navy (#0C2451, "trust and
// sophistication") paired with one bright signal blue (#3395FF, "Dodger
// Blue" — their actual documented brand hex) on an almost-white canvas.
// That reads as exactly right for a *consent & trust layer*: navy carries
// authority, the blue is reserved for the one thing that should pull the
// eye (a verified state, a primary action), and status colors stay
// desaturated tints rather than the neon greens/reds of a generic dark
// dashboard.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces
        canvas: "#F6F8FC",
        surface: "#FFFFFF",
        surfaceMuted: "#F1F5FB",
        surfaceSunken: "#EAF0F8",

        // Structure
        border: "#E3E8F1",
        borderStrong: "#CBD5E4",

        // Text
        navy: "#0C2451",
        navySoft: "#3E4C6B",
        muted: "#64748B",
        faint: "#94A3AF",

        // Brand
        brand: "#3395FF",
        brandDark: "#1C6FE0",
        brandTint: "#EAF3FF",

        // Semantic status — tint + solid pair for each
        success: "#149469",
        successTint: "#E4F6EE",
        warning: "#DB8B0B",
        warningTint: "#FDF2DF",
        danger: "#E23F3F",
        dangerTint: "#FBEAEA",
        revoked: "#7C5CE0",
        revokedTint: "#F0ECFC",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "JetBrains Mono",
          "Roboto Mono",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "10px",
        lg: "14px",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(12,36,81,0.04), 0 1px 6px -1px rgba(12,36,81,0.06)",
        cardHover: "0 4px 16px -4px rgba(12,36,81,0.14)",
        popover: "0 12px 32px -8px rgba(12,36,81,0.22)",
      },
      letterSpacing: {
        wordmark: "-0.01em",
        label: "0.07em",
      },
    },
  },
  plugins: [],
};

export default config;
