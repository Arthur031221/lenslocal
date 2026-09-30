import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/lenslocal/",
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 5000,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
