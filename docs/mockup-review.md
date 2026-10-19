# Portfolio redesign: mockup review and plan

**Date:** 2026-10-11
**Status:** Accepted (plan). Implementation not started.
**Inputs:** `mockups/portfolio-v1.html` … `portfolio-v4-editorial.html`, `CONTEXT.md`,
`CONTENT.md`, `SPEC.md`, `docs/adr/0001-astro-rebrand.md`,
`a private career-retrospective note` (the month-one
retrospective), and the SocialPrachar GitHub-portfolio checklist.

This file records the mockup decision, the content-compliance rules the redesign must
obey, and the build sequence. It does not itself add facts: every fact named below still
has to be carried by the CV first (CONTENT.md rule 11).

---

## 1. Verdict on the four mockups

| Mockup | Direction | Verdict |
|---|---|---|
| v1 | Restyled live site + portrait + impact band; `$ whoami` kept | Safe but least distinctive; drops the blog from the homepage |
| **v2** | Editorial senior-engineer: Fraunces serif display, Plex body/mono, dark-first, About + fact card, writing cards, Open Source list | **Chosen base** |
| v3 | Bento tile dashboard, Inter Tight, indigo, scan-first | Rejected: identity drift (indigo vs teal), omits Skills and Education sections, bento reading order diverges from DOM |
| v4 | Swiss label/content two-column, Space Grotesk + Newsreader, orange, no cards | Rejected as a direction, but its calm `dl`-style rows are borrowed for nothing after the Skills call; facts in it are wrong (degree, skills, repo copy) |

**Base = v2**, with the removals and changes in section 3.

Why v2: it keeps the existing teal identity (v3/v4 switch palettes), is story-led rather
than widget-led (matches the "Full-stack & Platform, story-first" steer), and its chip-group
Skills layout is the one the author picked.

---

## 2. Decisions log

| # | Decision | Rationale |
|---|---|---|
| D1 | Remove every "Open to work" / availability signal | A pulsing availability badge reads as "open to anything", which signals haste; the site should read as a deliberate senior professional, not a job-seeker in panic |
| D2 | Remove the metrics / impact stat band (v1/v2 band, v3 `stats`/`facts` tiles) | Duplicated facts already told in About + Experience; source of `100k`/`1M+` precision drift; the number-grid is a portfolio cliché |
| D3 | Keep the Products section, enriched into dossier cards | Products prove shipped work; enrichment (overview, scale, time, stack) makes them read as artifacts, not duplicate company entries |
| D4 | Remove the hero Code Card | It reads as a gimmick and can mislead about what the author does day to day |
| D5 | Keep Skills in **v2's chip-group layout**, full list | The site is the broad, evergreen surface; the CV is tailored per job. Kafka/K8s/Go stay; `eventrelay` is in progress |
| D6 | Keep Writing, link to real `/blog` routes | Writing + the site drive outreach; the CV stays per-job |
| D7 | No live-demo links on Open Source | No project has a live demo today |
| D8 | Storyline: **Full-stack & Platform**, story-led | Replace widget chrome with narrative; case studies are the strongest proof-trail |
| D9 | Surface large-scale / high-performance as a theme, in prose | The retrospective's key strength (100K req/hr, 500K jobs/hr) belongs in narrative, not a stat band |
| D10 | Terminal identity becomes light texture (mono labels/meta), not a widget | Keeps the identity thread without the code-card gimmick |

---

## 3. Target home structure

Order (keeps v2's order):

1. **Header** — name, section nav + `/blog`, theme toggle
2. **Hero** — name, `Senior Software Engineer · Full-stack & Platform`, value line naming the LLM platform + one scale note, actions (Resume, GitHub, LinkedIn, Email). No availability badge, no code card.
3. **About** — story-led narrative
4. **Writing** — case studies / notes, real `/blog` links
5. **Experience** — corrected dates; scale woven into bullets as prose
6. **Products** — enriched dossier cards (see 4.6)
7. **Open Source** — repos, no demo links
8. **Skills** — v2 chip groups
9. **Education**
10. **Contact**

**Removed:** stat/impact band · all availability text · Code Card · demo links ·
scroll-reveal and scroll-progress chrome.

**Identity:** v2 base (Fraunces serif display + IBM Plex body/mono, teal accent,
dark-first). Fraunces is a new font and must be self-hosted via `@fontsource`, not a
font CDN (SPEC section 5).

---

## 4. Section specs

### 4.1 Hero
- Name, canonical title `Senior Software Engineer · Full-stack & Platform` (CONTENT.md
  section 1). No deviation to "Backend & Platform".
- Value line leads with the LLM platform and reliability, keeps one scale clause.
- Actions: Resume (`/resume.pdf`), GitHub, LinkedIn, Email (`#contact`).
- No code card. No availability pill.

### 4.2 About
- Story-led, first person, full-stack + platform through-line.
- Delete the invented `relocation ok` / `work model` claims.
- No duplication of the hero verbatim; About goes one layer deeper.

### 4.3 Writing
- Render 3–4 posts with **real** titles from `src/content/blog/*.md`:
  `7.33M rows per call`, `One engine, three providers`, `Draining, not stopping`,
  `The verdict lives in code, not the prompt`.
- Each links to `/blog/{slug}`; section CTA links `/blog`.
- No invented titles, no `#` placeholders.

### 4.4 Experience
- Dates corrected: AI translation platform (under NDA) `Dec 2024 – Sep 2026` (recompute `duration`).
- Scale is prose, not a widget. After the CV update, the retrospective's section-7
  numbers land here as bullets: autoscaler + DynamoDB state store + throughput, DB
  concurrency, ECS throughput.
- Three bullets + "Show N more" toggle stays.
- Tags only name tech already in that entry's story.

### 4.5 Open Source
- Repo name, description, `role · outcome`, GitHub link, tech tags. No demo links.
- Elevate `eventrelay` to the top once it exists.

### 4.6 Products (enriched dossier card)
Field set per card:

| Field | Source | Note |
|---|---|---|
| Badge + name | `bigProjects.projects[].projectName` | |
| One-line what-it-is | new `tagline` | artifact framing, not a job line |
| Overview | `projectDesc` (rewritten) | distinct wording from Experience |
| Scale | CV-sourced, prose | only where the CV carries a number |
| Time | new `timeframe` | **author's engagement window**, not product age |
| Stack | new `stack[]` | tech already in that product's story |
| Link | `footerLink` | `Visit website` (real product URL) |

Anti-duplication rule: the card must read as an artifact dossier. The labeled meta rows
(Overview / Scale / Time / Stack) are what separate it from the Experience timeline even
where names repeat (`Dailymealz`, `Nformacy`).

Scale availability today: AI (`over a million sites`) and Dailymealz
(`100,000 daily users`) have CV numbers; Shapa and Nformacy do not, so they carry
qualitative scale until the CV adds a figure.

### 4.7 Skills
- v2 chip-group layout, all CV rows (CONTENT.md section 1, ten rows).
- Keep Kafka, Kubernetes, Go, DynamoDB per D5. Known risk: the retrospective's
  interview-trap rule holds these until `eventrelay` lands; `eventrelay` is in progress.

### 4.8 Education
- `Faculty of Science Cairo University`, `BSc in Geophysics`, `Sep 2012 – Jun 2016`.
- Keep Geophysics (the v4 change to "Computer Engineering" was wrong).

### 4.9 Contact
- Use the CONTENT.md subtitle verbatim; delete the invented "I usually reply within a
  day" and "Let's build something reliable".
- Email, GitHub, LinkedIn, timezone. No availability status.

### 4.10 Footer
- `© 2026 Abdelwahab Mahmoud · built with astro · hosted on github pages`.

---

## 5. Content-compliance checklist

Every change must pass these (CONTENT.md section 2, SPEC.md section 6):

- [ ] No availability / "open to work" text anywhere.
- [ ] No stat/impact band.
- [ ] No em dashes in prose (company/product names exempt).
- [ ] Past tense for every job except the current-tense rule (post-fix, no job is current).
- [ ] Every number traces to the CV; no restating a CV number at a different precision
      (`100,000` not `100k`; `over a million` not `1M+`).
- [ ] Company/product/school names exactly per CONTENT.md section 1.
- [ ] No emoji in prose; no self-assessment numbers; no template voice.
- [ ] No invented copy ("reply within a day", "relocation ok", fabricated repo blurbs).
- [ ] Real blog titles and real routes; no `#` placeholders.
- [ ] Code card removed; its `@astrojs/react` island removed from the homepage (React
      stays only if still used for blog diagrams).

---

## 6. Dependency sequence (CV → CONTENT → data → site)

The site must not show facts the CV lacks (CONTENT.md rule 11). Order:

1. **CV** (`~/projects/playground/Awesome-CV`, `examples/resume/experience.tex`):
   - end date `Sep 2026`; recompute duration;
   - apply retrospective section-7 bullets (autoscaler + DynamoDB state store +
     throughput; DB concurrency; ECS throughput); confirm the `1.5M+` vs `over a
     million` figure before either goes public.
2. **`CONTENT.md`**: mirror dates + bullets; remove availability from the hero chips;
   record the new Products fields.
3. **`src/data/portfolio.ts`**: dates, bullets, `greeting.chips` (drop availability),
   `bigProjects` new fields (`tagline`, `timeframe`, `stack[]`), remove `codeSnippets`
   if the code card is dropped.
4. **Site** (`src/pages/index.astro`, `src/layouts/Base.astro`, `src/styles/global.css`):
   rebuild the shell to section 3/4; wire Products dossier, Writing teaser, Skills
   chip groups; delete the stat band, hero code card, reveal/scroll-progress.
5. **Verification** per SPEC.md section 6.

---

## 7. Open items

- **Hero portrait**: no decision yet. Options: real headshot, a deliberate monogram, or
  none. A placeholder frame must not ship.
- **Tagline**: keep `Full-stack & Platform` (D8) — confirm no change to the canonical
  title string.
- **Shapa / Nformacy scale**: no CV number; keep qualitative or omit the Scale row.
- **React island**: confirm whether `@astrojs/react` is still needed (blog diagrams) after
  the code card is removed.

---

## 8. Acceptance criteria

- `npm run build`, `npm test`, `npm run check-format` pass.
- No availability text, no stat band, no code card, no demo links, no reveal/scroll chrome.
- Product cards show Overview / Scale / Time / Stack and read as artifacts, not jobs.
- Blog titles/routes match `src/content/blog/*.md`.
- Dates say `Dec 2024 – Sep 2026` everywhere; duration recomputed.
- Content renders with JS disabled (no opacity-0 reveal content).
- Contrast AA both themes; keyboard focus visible; `prefers-reduced-motion` respected.
- Lighthouse recorded before/after, mobile + desktop; no pre-claimed numbers.
