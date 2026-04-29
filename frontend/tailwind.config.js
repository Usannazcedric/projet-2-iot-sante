/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        level: {
          1: "#3b82f6",
          2: "#eab308",
          3: "#f97316",
          4: "#dc2626",
          5: "#0a0a0a",
        },
      },
    },
  },
  plugins: [],
};
