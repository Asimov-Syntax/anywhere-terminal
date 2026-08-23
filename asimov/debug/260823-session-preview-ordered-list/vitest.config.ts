import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["asimov/debug/260823-session-preview-ordered-list/repro.test.ts"],
  },
});
