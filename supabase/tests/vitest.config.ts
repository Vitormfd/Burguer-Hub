import { defineConfig } from "vitest/config";

// Instale uma vez, dentro desta pasta: cd supabase/tests && npm install
// Depois, na raiz do projeto: npm run test:banco
export default defineConfig({
  root: import.meta.dirname,
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
