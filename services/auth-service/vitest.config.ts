import { defineConfig } from "vitest/config";

const isExplicitPostgresRun = process.argv.some((arg) => arg.includes("postgres"));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      ...(isExplicitPostgresRun || process.env.TEST_DATABASE_URL
        ? []
        : ["src/test/postgres-auth-flow.integration.spec.ts"]),
    ],
    setupFiles: ["./vitest.setup.ts"],
  },
});
