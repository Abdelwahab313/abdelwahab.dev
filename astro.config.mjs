import {defineConfig} from "astro/config";
import sitemap from "@astrojs/sitemap";
import remarkDiagrams from "./src/lib/remark-diagrams.mjs";

export default defineConfig({
  site: "https://abdelwahab.dev",
  integrations: [sitemap()],
  redirects: {
    "/blog/aurora": "/blog/fixing-aurora-mysql-100-percent-cpu-by-removing-a-join",
    "/blog/engine": "/blog/handling-llm-rate-limits-as-reschedules-not-errors",
    "/blog/fargate": "/blog/scaling-ecs-workers-on-queue-depth-without-killing-long-jobs",
    "/blog/fulfillment-extraction": "/blog/extracting-fulfillment-from-a-php-monolith-over-sqs",
    "/blog/mobile-backend": "/blog/live-order-status-over-socket-io-and-redis",
    "/blog/redis-lua-race-conditions": "/blog/preventing-stock-overselling-in-redis-with-lua-scripts",
    "/blog/triage": "/blog/making-llm-triage-verdicts-testable-in-code",
    "/blog/zero-to-launch": "/blog/building-a-booking-marketplace-from-empty-repo-to-beta"
  },
  markdown: {
    smartypants: false,
    remarkPlugins: [remarkDiagrams],
    shikiConfig: {
      themes: {light: "github-light", dark: "github-dark-dimmed"},
      defaultColor: false,
      wrap: false
    }
  }
});
