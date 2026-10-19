import {defineConfig} from "astro/config";
import sitemap from "@astrojs/sitemap";
import remarkDiagrams from "./src/lib/remark-diagrams.mjs";

export default defineConfig({
  site: "https://abdelwahab.dev",
  integrations: [sitemap()],
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
