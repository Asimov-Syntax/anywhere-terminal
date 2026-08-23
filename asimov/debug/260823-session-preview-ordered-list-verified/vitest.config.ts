import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    disableConsoleIntercept: true,
    include: ["asimov/debug/260823-session-preview-ordered-list-verified/repro.test.ts"],
  },
});
