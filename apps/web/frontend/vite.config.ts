import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Repo root .env instead of Vite's default (this project's own
  // directory) - one file shared with the backend and Docker Compose.
  // Only VITE_-prefixed keys are ever exposed to client code; anything
  // else in the same file (e.g. TMDB_API_KEY) stays invisible to Vite
  // regardless of envDir - that's Vite's own filtering, not a matter
  // of file location.
  envDir: resolve(import.meta.dirname, "../../.."),
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
