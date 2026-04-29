import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
      "/sim": { target: "http://localhost:9100", changeOrigin: true, rewrite: (p) => p.replace(/^\/sim/, "") },
      "/ws": { target: "ws://localhost:8080", ws: true, changeOrigin: true },
    },
  },
});
