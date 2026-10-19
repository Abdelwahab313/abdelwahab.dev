# CONTEXT

Glossary of canonical terms for this portfolio's content. The site's copy (src/data/portfolio.ts, src/layouts/Base.astro meta tags, resume) must agree with these terms. Canonical facts, tone rules and paste-ready copy live in CONTENT.md.

## Terms

### Positioning
The one-line professional identity used in the greeting, SEO meta, and resume. Canonical: **"Senior Software Engineer · Full-stack & Platform"**, eight years in (career start: Jan 2018). The years figure is derived from the career start date and must be re-checked yearly — never hardcoded in more than one place mentally; the greeting is its single on-site source.

### Experience
A full-time employment entry in the Work Experience section. Ordered newest-first. Every Experience has a real (non-placeholder) description. All four entries are past tense; no role is current. Timeline: AI translation platform (under NDA) (Dec 2024 – Sep 2026) → Dailymealz (Dec 2021 – Dec 2024) → Nformacy → DevSquads (formerly Fikr Labs). Four entries, not five. Company names exactly as in CONTENT.md section 1.

### Voice
All site copy reads as human-written: no em dashes, no symmetrical buzzword bullets, no stock AI phrasing ("Design and ship", "Drive product decisions"). Short sentences, first person, concrete over abstract. Matches the site's existing casual tone. Company and product names taken verbatim from the CV are exempt from the em dash rule.

### Product
A product the user helped build, linked from its Experience entry (`product` name and website). There is no separate Products section: the job tells the story, the link points at the artifact.

### Case study
A Blog post with `kind: "case-study"`: one system, written as Situation / Decision / Trade-off / Outcome. Those four are `##` headings in the Markdown body, in that order, and the build fails if one is missing. A Case study may go deeper than the two-page CV. The four migrated posts (`fargate`, `engine`, `aurora`, `triage`) carry the same arc under their own headings and are published as `kind: "note"`.

### Blog post
One entry in the single `/blog` stream. Authored as exactly one file in `src/content/blog/{slug}.md`: strict frontmatter metadata plus a Markdown body that carries all prose, code, tables and images. Discovered automatically by Astro content collections, never by editing a registry. Two kinds: `case-study` and `note`; the kind sets the label and the `/work` grid filter, nothing else. A post with `status: "draft"` is visible in development only. Authoring contract: `docs/BLOG.md`.

### Section head
The serif heading that titles each homepage section (`About`, `Writing`, … `Education`). Decoration, not prose, so it is exempt from the Voice rules — but it must not introduce facts that are not in the CV.

### Work page
The dedicated `/work` route: the six challenge cards as links to their write-ups, plus a grid of every published `case-study` post. The challenge cards live only here, not on the homepage; the nav's Work item points to `/work`. Every challenge card's `article` field names a real post slug, and the build fails (via `assertArticlesExist`) if it drifts.

### Featured post
The one post with `featured: true` in frontmatter, rendered as the large first card on `/blog`. At most one may exist; the build fails otherwise. Its `cover` is the path to an SVG in `public/img/blog/`, always paired with `coverAlt`.
