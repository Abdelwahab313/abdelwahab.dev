# Writing a post

One post is one file: `src/content/blog/<slug>.md`. The slug is the filename
(gone is the old `slug` field and the `scripts/gen-blog-index.js` registry
step). Drop the file in and `npm run build` picks it up. Schema is validated at
build time by `src/content.config.ts`; a bad field names the exact problem.

The agentic pipeline that produces drafts (research, write, review agents
plus the `/blog` orchestrator command) is defined in `docs/BLOG-WORKFLOW.md`.

## Template

````md
---
title: Queue depth beats CPU percentage
kind: note
status: draft
date: 2026-11-02
order: 0
lede: One line, at most 160 characters, shown on the index and used as the page description.
tags: [aws, ecs]
---

## What broke

One paragraph. Then another.

## What I changed

Code, tables and images are plain Markdown:

```sh
aws ecs describe-services --cluster workers --services translate
```
````

The frontmatter is metadata only. Everything the reader sees below the lede
is the Markdown body. Every `##` heading becomes a TOC entry on the page; keep
headings at `##` and `###`, never `#` (the title is the `h1`).

## Fields

| Field | Required | Notes |
|---|---|---|
| Filename | yes | Becomes `/blog/<slug>`. Must match the frontmatter contract: no space, no uppercase. |
| `title` | yes | Page heading and index row. |
| `kind` | yes | `"case-study"` or `"note"`. |
| `status` | yes | `"draft"` or `"published"`. |
| `date` | yes | `YYYY-MM-DD`. Index sorts by this, newest first. |
| `order` | no | Integer, ascending. Only breaks ties inside the same `date`. |
| `lede` | yes | At most 160 characters. Index row and meta description. |
| `tags` | no | Array of short lowercase strings, rendered as `#tag`. |
| `featured` | no | Boolean, default `false`. Highlights the post on the index. At most one post may set it (enforced in `src/lib/blog.ts`). |
| `cover` | no | Path to a cover image, rendered above the title when set. Must come with `coverAlt`. |
| `coverAlt` | with `cover` | Alt text for the cover image. A `cover` without it, or it without a `cover`, fails the schema. |

The schema is strict: any other key fails the build. Prose, code, tables and
images live in the Markdown body, not in frontmatter.

## Kinds

`kind` only drives the label on the post page and the "Case studies" grid on
`/work`. Both kinds are written the same way: frontmatter plus a Markdown body.

**`case-study`** - one system, told as Situation / Decision / Trade-off /
Outcome. The body must carry exactly those four `##` headings, in that order
(`## Situation`, `## Decision`, `## Trade-off`, `## Outcome`); the build fails
otherwise (`assertCaseStudyHeadings` in `src/lib/blog.ts`). Other headings may
sit between or after them.

**`note`** - any set of `##` headings. The four migrated posts (`fargate`,
`engine`, `aurora`, `triage`) are notes: they carry the case-study arc across
their own headings. Read one of them before writing the next.

Reading time is computed from the body plus the lede at 200 words per minute.

## Rules

Tone rules live in `CONTENT.md` section 2. The two that catch most drafts:

1. Numbers about the author's own work come from the CV only, no new figures.
   A learning-topic post about an external system may use an external number
   (benchmark, limit, version, price) only when the researcher verified it
   against a first-party source and the dossier carries that source. See
   `docs/BLOG-WORKFLOW.md`, "Standing decision: numbers from outside the CV".
2. No em dashes in site prose. Full stops and commas only.
3. Anonymous unless agreed. No product or company names in a post, and no
   outbound product link. The four migrated case studies were anonymized
   2026-10-08: bodies keep only the names of public tooling (AWS services,
   OpenAI, Bedrock, Gemini, Langfuse), never the product, the employer, or an
   employer URL.

Case studies may be deeper than the two-page CV. That is the point of the
section: the CV is the summary, the case study is the reasoning.

## Previewing a draft

```sh
npm run dev
```

Open `http://localhost:4321/blog/<slug>`. A draft shows a `Draft` badge and
is listed on `/blog`.

Drafts are filtered out when the build runs in production, so `npm run build`
and the deployed site never include them. If you set `status` back to `draft`,
the post disappears from the deployed site.

## Publishing

1. Flip `status` to `"published"`.
2. `npm run build` - the content schema names the exact field that failed.
3. `npm preview` and confirm `http://localhost:4321/blog/<slug>` renders with
   a `200`.
4. Deploy.

## Images and diagrams

Figures are hand-authored SVG that follows the page theme. Two kinds:

- **Cover**: `public/img/blog/<slug>.svg`, `viewBox="0 0 1200 600"`, named in
  frontmatter as `cover` with a `coverAlt`. The page inlines it (so CSS
  variables apply) and the same file is served standalone for `og:image` and
  feeds, where the `var(--x, #hex)` fallbacks give the dark palette.
- **Diagram**: `src/diagrams/<slug>-<name>.svg`, placed in the body with
  `![Caption](diagram:<slug>-<name>)` on its own line. The remark plugin in
  `src/lib/remark-diagrams.mjs` inlines it as a `<figure class="diagram">` with
  the caption as `<figcaption>` and the build fails if the file is missing.
  Astro caches rendered Markdown by the `.md` file, so after editing only a
  diagram run `npx astro build --force` (or touch the post).

Rules, enforced by review:

1. **One idea per figure.** A figure exists because prose could not carry the
   shape: a sequence, an interleaving, a before/after, a control loop, a
   quantity. If a reader learns nothing from it that the text did not say,
   cut it. Two or three figures per post, placed right after the paragraph
   they explain.
2. **Colours are the page's tokens, never literals.** Every `fill`/`stroke`
   is `var(--token, #dark-fallback)`: `--ink #edeae3` (primary strokes and
   labels), `--muted #949aa2` (secondary labels, things that are idle, dead or
   dashed), `--body #c2c7cd` (longer text), `--border #262b33` (axes, tracks),
   `--surface #161a20` (box fills and the cover background), `--accent
   #57c7ba` and `--accent-soft rgba(87,199,186,0.12)` (the one thing the
   figure is about). One accent; nothing else coloured.
3. **Type**: `font-family="var(--font-mono, ui-monospace, SFMono-Regular, Menlo,
   monospace)"` on the root. Labels are 15px on a 960 to 1080 wide diagram.
   Covers use 26 to 30px and at most five short labels, no sentences: they
   render at 132px wide in the list, so shapes must carry the meaning.
4. **Marks**: 1.5px strokes for diagrams, 3 to 4px for covers; `rx` 8 to 10 on
   boxes (18 on covers); dashed = removed, killed or hypothetical; arrows via a
   `<marker>` per colour (`#ink`, `#acc`) with `orient="auto-start-reverse"`.
   No drop shadows, gradients, grids, dotted backgrounds or frames.
5. **Text is text.** Labels sit in `--ink`/`--muted`, never in the accent
   colour unless they name the accented element. Nothing overlaps: check at
   full width and at 375px (the SVG scales down; 15px labels stay legible to
   about 960/375 scale).
6. **Charts**: one hue for magnitude (accent), thin bars anchored to a
   baseline in `--border`, direct labels on the bars that matter, no legend
   for one series, no dual axes, no number on every point. Figures come only
   from the post's sourced numbers.
7. **Captions** state what the figure shows in one or two sentences and are
   the SVG's `aria-label` too, so they must read without the picture.
8. **Render before committing.** `/tmp/render-svg.sh file.svg out.png light`
   and `dark` (headless Chromium with the site's variables), then look at
   both. The exemplars are `public/img/blog/fargate.svg`,
   `src/diagrams/fargate-stop-vs-drain.svg` and
   `src/diagrams/fargate-scaler-loop.svg`.

Raster images go under `public/img/blog/` and use standard Markdown with real
alt text; prefer a diagram.