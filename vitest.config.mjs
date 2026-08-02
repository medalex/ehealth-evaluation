import { defineConfig } from 'vitest/config';

// Scenarios hit the live stack and (on a fresh stack) poll for consent to anchor in the DKG,
// so the timeouts are large. allure-vitest emits results to ./allure-results.
export default defineConfig({
  test: {
    include: ['bench-correctness/**/*.test.mjs'],
    // allure-vitest v3: pass the reporter as a plain string (it registers its own setup).
    // Output dir defaults to ./allure-results (override with ALLURE_RESULTS_DIR).
    reporters: ['default', 'allure-vitest/reporter'],
    testTimeout: 900_000, // 15 min — first DKG writes on a fresh stack can lag
    hookTimeout: 900_000,
    // Stream console.log straight to stdout (don't buffer per-test) so the heartbeat during
    // long DKG-anchoring waits is visible live in `docker compose logs`.
    disableConsoleIntercept: true,
    sequence: { concurrent: false }, // scenarios share consent/allergy state; run in order
    fileParallelism: false,
  },
});
