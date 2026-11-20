interface Env {
  /**
   * Worker secret. Set with `wrangler secret put RATE_LIMIT_PEPPER`.
   * Absent until that secret exists. Local `npm run dev` injects a placeholder.
   */
  RATE_LIMIT_PEPPER?: string;
}
