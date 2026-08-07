/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "#F5F6F8",
          surface: "#FFFFFF",
          border: "#E3E6EA",
          text: "#1A1D21",
          "text-muted": "#6B7280",
        },
        brand: {
          DEFAULT: "#2557D6",
          hover: "#1E47B8",
        },
        status: {
          "clear-fg": "#15803D",
          "clear-bg": "#DCFCE7",
          "review-fg": "#B45309",
          "review-bg": "#FEF3C7",
          "reschedule-fg": "#B91C1C",
          "reschedule-bg": "#FEE2E2",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
