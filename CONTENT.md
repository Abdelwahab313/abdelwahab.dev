# CONTENT

Single source for what the site says and how it says it. The CV is the source of truth for
facts; this file is the source of truth for site wording. When the two disagree, fix the CV
first, then this file, then `src/data/portfolio.ts` and the page meta in the Astro layout
(`src/layouts/Base.astro`).

CV source: `~/projects/playground/Awesome-CV`, branch `cv/automattic-experienced-swe`, files under
`examples/resume/`. Built with LuaLaTeX via `make resume.pdf`. Built PDF: `examples/resume.pdf`.

Last aligned: 2026-10-11.

---

## 1. Canonical facts

Every value below appears verbatim in the CV. The site must not vary spelling, casing, dates
or titles.

| Field | Value |
|---|---|
| Name | Abdelwahab Mahmoud |
| Title | Senior Software Engineer · Full-stack & Platform |
| Location | Cairo, Egypt (UTC+3) |
| Email | abdelwahabahmed93@gmail.com |
| Phone | +20 114 778 4094 |
| Career start | January 2018 |
| Years | "eight years" or "8+ years" (recheck each January) |
| GitHub | github.com/abdelwahab313 |
| LinkedIn | linkedin.com/in/abdelwahab313 |
| Site | abdelwahab.dev |

### Employment

| Company | Location | Title | Dates |
|---|---|---|---|
| AI translation platform (under NDA) | Remote | Senior Software Engineer | Dec 2024 – Sep 2026 |
| Dailymealz | Riyadh, Saudi Arabia | Senior Software Engineer | Dec 2021 – Dec 2024 |
| Nformacy | Cairo, Egypt | Full-Stack Developer | Oct 2020 – Dec 2021 |
| DevSquads (formerly Fikr Labs) | Cairo, Egypt | Software Engineer | Jan 2018 – Oct 2020 |

Four entries, not five. No role is current; every entry is past tense.

### Skills (same rows as the CV)

| Row | Skills |
|---|---|
| Languages | PHP, TypeScript, JavaScript, Go, Ruby, Java (Spring), Python, SQL |
| Backend | Ruby on Rails, Node.js, REST API design, service-oriented architecture, SQS, Kafka |
| Frontend | Next.js, React, Redux, Hotwire (Turbo & Stimulus), React Native, Tailwind CSS |
| AI & LLM | AWS Bedrock, OpenAI, Gemini, agentic workflows, Claude Agent SDK, MCP, Langfuse, evals |
| Cloud & Infrastructure | AWS (ECS Fargate, Lambda, SQS, Step Functions, CloudWatch, S3, IAM), Kubernetes, Terraform, Docker, GitHub Actions, GitLab CI |
| Observability | Datadog, OpenTelemetry, AWS CloudWatch, Langfuse tracing |
| Databases | PostgreSQL, MySQL, Aurora, Redis, DynamoDB, ClickHouse |
| Testing | TDD, Spec-driven development, RSpec, Capybara, Playwright, Cypress, Jest, VCR |
| Compatibility & i18n | backwards compatibility, deprecation paths, contract tests, i18n |
| Spoken Languages | English, Arabic (native) |

Site skill icons are a subset of this table, in this order: Ruby on Rails, AWS, Terraform,
Docker, MySQL, PostgreSQL, Redis, Python, React, JavaScript, React Native, Node.js. Anything
not in the table above does not get an icon (drops Kubernetes, GitHub Actions, ClickHouse,
Laravel, Firebase, html-5, css3, sass).

---

## 2. Tone

The CV is terse and third person. The site is first person and a little warmer. Same facts,
same numbers. Positioning is full-stack and platform: product work across React, Next.js,
React Native, Rails and Node.js, with the AWS platform, databases and LLM systems underneath.

Rules, in priority order:

1. **Past tense for every job.** No role is current, so every bullet is past tense.
2. **Concrete over abstract.** A bullet names a system, a change, and why. "Built full-stack
   features across the translation pipeline" says nothing. "Moved the product off a single EC2
   host onto ECS Fargate" says something.
3. **Every number comes from the CV, said the way a person would say it.** The CV is the
   defensible set; do not add a number it does not carry. Round to conversational precision:
   "about a thousand calls", "7 million rows", "a two-hour job", "a year and a half". A figure
   like 1,013 or 1h 42m reads as generated, not measured. Headline scale figures stay as the
   CV states them (500K, ~5K, ~100K, 100K, 30%).
4. **No template voice.** Banned: "cool stuff", "like a pro", "whipping up", "slick",
   "silky-smooth", "crush goals", "all the things", "leveling up", "tech tricks", "love affair",
   "I'm that guy". No exclamation marks.
5. **No emoji in prose.** Emoji may remain only where the template uses them as icons
   (section headings), not inside sentences.
6. **No em dashes in site prose.** Use a full stop or a comma. Company and product names taken
   verbatim from the CV are exempt.
7. **No self-assessment numbers.** Proficiency bars off (`viewSkillBars: false`).
8. **No availability signals.** No "open to work" badges or status pills anywhere. Location
   lives in the About fact card. The site shows no timezone, so it does not narrow which
   roles or regions a reader assumes.
9. **No filler lines.** The Geophysics "leveraged strong analytical skills" sentence goes.
10. **Company and product names exactly as in section 1.** Not "DailyMealz", "nformacy",
    "Devsquads", "Fikrlabs".
11. **The most recent employer is under NDA.** The site never names it, its products, its
    brands, its office location or links to them, in copy, posts, images, structured data or
    docs. It appears only as `AI translation platform (under NDA)`. Generic domain words
    (AI translation, LLM jobs, metered product) and public tooling names are fine. The CV
    PDF at `/resume.pdf` and the repo history are out of scope: the author confirmed both are
    fine as they are (2026-10-18).
12. **CV stays canonical until told otherwise.** Never "fix" the site by inventing a fact the
    CV lacks (Shell scripting is the standing example: real, but not on the CV, so not on the
    site). The only way to add such a fact is to update the CV first.

---

## 3. Site copy

Paste-ready. Keys refer to `src/data/portfolio.ts` unless noted.

### Hero (`greeting.title`, `greeting.subTitle`, `greeting.valueProp`, `greeting.startHere`)

Title: `Abdelwahab Mahmoud`

Subtitle (role line): `Senior Software Engineer · Full-stack & Platform`

Value line:

> I build and run production systems end to end, from React in the browser to AWS
> underneath. Most recently: the LLM engine and cloud platform behind an AI translation
> product that peaked at ~100K requests an hour.

No quick-facts row in the hero: location, years and languages live once, in the About fact
card (`Location`, `Core stack`, `Experience`, `Languages`).

Actions: Resume (`/resume.pdf`), GitHub, LinkedIn, Email (`#contact`). No availability badge,
no code card and no product card in the hero.

Start here (`greeting.startHere`): links to the `fargate`, `engine` and `aurora` posts by
title. The build fails if a slug has no post. The homepage Writing section shows the three
newest posts that are not already in Start here.

### Meta (`src/pages/index.astro` title and description)

Title: `Abdelwahab Mahmoud | Senior Software Engineer, Full-stack & Platform`

Description:

> Abdelwahab Mahmoud, senior full-stack and platform engineer in Cairo. React, Next.js and
> React Native, Ruby on Rails and Node.js, AWS (ECS Fargate, Lambda, Terraform) and LLM
> platforms over Bedrock, OpenAI and Gemini. Eight years building and operating production
> systems.

### Homepage order

Hero, About, Experience, Writing, Open source, Skills, Education, Contact. Each fact is told
once: About is how I work, Experience is what I did, Writing is the depth. There is no
Products section and no "What I work on" grid on the homepage; products are linked from their
Experience entry, and the challenge cards live only on `/work`.

### Work experience (`workExperiences.experience`)

Copy lives in `src/data/portfolio.ts`. Each entry renders, in order: company, role,
`headline`, `story`, a link row (`product` website, and the `article` write-up by its title
when `article` is set), `descBullets`, tags.

- `headline` names the hardest problem of the job and its outcome, as a plain sentence. It
  carries a CV number when the job has one. No wordplay, no label-style titles.
- `story` tells that problem: the product, what made it hard, what I changed. It absorbs the
  CV bullets it tells, so those bullets do not repeat below it.
- `descBullets` hold every remaining CV bullet, hardest first. Together, story and bullets
  carry every fact of the CV entry; nothing is dropped and nothing is added.
- More than four bullets show three and a "Show N more" toggle; four or fewer show all.

| Company | headline | product | article |
|---|---|---|---|
| AI translation platform (under NDA) | Scaled AI translation to 500K jobs an hour at peak without killing a job mid-run | none (under NDA) | `fargate` |
| Dailymealz | Pulled fulfillment out of a PHP monolith while 100K daily users kept ordering | Dailymealz, `https://dailymealz.com/` | `fulfillment-extraction` |
| Nformacy | Took a two-sided marketplace from empty repo to beta launch | Nformacy, `https://nformacy.com/` | `zero-to-launch` |
| DevSquads (formerly Fikr Labs) | Built Shapa's mobile app and backend test-first, and mentored teams adopting XP | Shapa, `https://shapahealth.com/` | none |

Source: facts follow `examples/resume/experience.tex` on `cv/automattic-experienced-swe`
(aligned 2026-10-11). Order within an entry is the site's choice; the facts are the CV's.
Four entries. Fikr Labs is the earlier name inside the DevSquads entry, exactly as the CV
states it.

#### Timeline metadata (`duration`, `location`, `tags` on each entry)

The experience section renders as a vertical timeline. Each entry carries a duration and a
short location next to the date, and a row of tech chips under the text. Duration is the
month difference between the two dates. Tags may only name tech that already appears in that
entry's own description or bullets.

| Company | duration | location | tags |
|---|---|---|---|
| AI translation platform (under NDA) | 1 yr 9 mo | Remote | Ruby on Rails, React, ECS Fargate, Lambda, Terraform, Aurora, Bedrock, DynamoDB |
| Dailymealz | 3 yrs | Riyadh | React Native, Node.js, AWS, Datadog, Redis |
| Nformacy | 1 yr 2 mo | Cairo | React, Ruby on Rails |
| DevSquads (formerly Fikr Labs) | 2 yrs 9 mo | Cairo | React, React Native, Node.js, Java Spring, TDD |

`duration` for the AI translation role is December 2024 to September 2026.

### Blog posts (`src/content/blog/`, replaces the old `caseStudies` section)

Case-study copy no longer lives in the data module or in this file. Each post is exactly one
file in `src/content/blog/{slug}.md`, discovered automatically by Astro content collections
and validated against the Zod schema in `src/content.config.ts`. Never edit a registry.

Authoring contract, field table and copy-paste template: `docs/BLOG.md`. Tone rules still
come from section 2 above.

Index page (`/blog`) chrome, owned by `src/pages/blog/index.astro`:

Meta title: `Blog | Abdelwahab Mahmoud`

Heading: `Writing`

Subtitle:

> Notes and case studies from building production systems. What was tried, what cost,
> and what changed.

Meta description:

> Case studies and notes from eight years building production systems. What was there,
> what I decided, what it cost, and what changed.

The four migrated posts keep their body copy from the 2026-10-05 refresh, and are
published as `kind: note`: `fargate`, `engine`, `aurora`, `triage`. Titles say what
happened, under 60 characters, the way the blog-writer agent requires: no label titles a
reader has to decode. Post dates are spread across September and October 2026. Every post is frontmatter metadata plus a Markdown body; the `case-study` kind
carries Situation / Decision / Trade-off / Outcome as four `##` headings in that body.

Anonymized 2026-10-08: no product, company, or employer link in any post.
Bodies keep only the names of public tooling (AWS services, OpenAI, Bedrock, Gemini,
Langfuse). Rule of posting: docs/BLOG.md rule 3.

Numbers in those four trace to pre-2026-10-08 CV history; see SPEC.md section 8.

### Open source (`openSource.projects`)

Four public repositories, rendered after Writing. Copy lives in
`src/data/portfolio.ts` `openSource`. Each card shows the repo name, description,
`role · outcome`, a GitHub link and tech tags. Named repos, links and descriptions are the
author's real repos; do not invent new ones here without a matching repository.

### Education (`educationInfo.schools[0]`)

subHeader: `BSc in Geophysics`. duration: `Sep 2012 – Jun 2016`. desc: empty.

### Contact (`contactInfo.title`, `contactInfo.subtitle`, `contactInfo.email_address`)

Title: `Contact me` (plain text, no emoji)

Subtitle:

> Hiring for a senior full-stack or platform role, or stuck on a production problem? Email me.

Email per section 1.

### Footer

Footer line, mono, small: `© 2026 Abdelwahab Mahmoud · built with astro · hosted on github pages`.
No developerFolio credit remains.

---

## 4. Field map

Where each fact lives, so an edit in one place is mirrored in the others.

| Fact | CV (`examples/resume/`) | Site |
|---|---|---|
| Title line | `../resume.tex` position field | `greeting.subTitle`, meta description, `CONTEXT.md` Positioning |
| Summary | `summary.tex` | `greeting.subTitle` |
| Jobs, titles, dates | `experience.tex` | `workExperiences.experience[]` |
| AI translation role bullets | `experience.tex` first `cventry` | `workExperiences.experience[0].descBullets` |
| Skills | `skills.tex` | `cvStack` (chip groups in the Skills section) |
| Email, phone | `../resume.tex` header | `socialMediaLinks.gmail`, `contactInfo` |
| Education | `education.tex` | `educationInfo` |
| Years figure | `summary.tex` | `greeting.subTitle`, `CONTEXT.md` Positioning |
| Case-study and note copy | pre-2026-10-08 CV branches (SPEC.md section 8) | `src/content/blog/{slug}.md` |

Resume button (`greeting.resumeLink`) points at `/resume.pdf`, which is `public/resume.pdf`
in this repo and ships with every build as `https://abdelwahab.dev/resume.pdf`. On every CV
build, copy `examples/resume.pdf` from the CV repo over `public/resume.pdf` and redeploy.
Build the CV with `make resume.pdf` (LuaLaTeX), then re-run the extraction assertions in
SPEC.md section 7 before shipping.

---

## 5. Open items against the live site (2026-10-08)

- 2026-10-15 blog and work expansion: `/blog` gained tag chips with counts, a
  client-side search and filter, cover thumbnails and the featured card
  (`fargate` carries `featured: true`). New frontmatter: `featured`, `cover`,
  `coverAlt` (docs/BLOG.md). Three case studies shipped
  (`fulfillment-extraction`, `zero-to-launch`, `mobile-backend`), all six
  challenge cards' `article` fields are filled, `/work` is a real route, the
  nav's Work item points there, and `/atom.xml` joins `/rss.xml`. Case-study
  copy comes from the Dailymealz, Nformacy and DevSquads bullets above, with
  the anonymity and no-new-numbers rules kept.

- 2026-10-11 redesign (docs/mockup-review.md, mockup v2): availability signals, the stat band
  and the hero Code card are removed; Products became dossier cards; Skills became chip
  groups; Writing links to `/blog`. AI translation role end date moved to `Dec 2024 – Sep 2026`, so no job is
  current and every bullet is past tense. Section-7 throughput and DB-concurrency bullets were
  added from the CV.
- 2026-10-08 alignment: CV branch `cv/automattic-experienced-swe` @ `a0103b9` is the source
  of truth. Positioning is now `Full-stack & Platform`; the AI translation role is current (`Dec 2024 – Present`);
  there are four entries, not five; skills are ten rows; the summary leads with AWS production
  systems and scale. Everything above mirrors it.
- 2026-10-08 Astro rebuild (branch `astro-rebrand`, ADR 0001): the site moved from the CRA
  fork to Astro. The hero gained the Code card in four CV-listed languages (TS, Ruby, Go,
  SQL); skill icons were replaced by the `stack.json` card in `src/data/portfolio.ts`.
  Blog posts are `.md` files in a content collection. URLs (`/`, `/blog`, `/blog/{slug}`),
  the domain and `/resume.pdf` are unchanged. Deploy is `FOLDER: dist` on the `gh-pages`
  branch, triggered from `main`.
- The 2026-10-05 case-study numbers (65%, 16 months, 90% Spot, 7.33M, 1,013, 7 ms, four ADRs;
  rounded in site copy on 2026-10-19 per rule 3,
  ISO 27001) were retired from the CV on 2026-10-06. The four case studies keep them by
  decision; see SPEC.md section 6 and section 8.
- Case studies moved off the homepage into `/blog` on 2026-10-08, alongside future articles.
  Authoring contract: `docs/BLOG.md`.
- `public/resume.pdf` resynced 2026-10-08 (`d875cdf9`, CV `a0103b9`).
- Nformacy product link is `https://nformacy.com/` (the old
  `https://beta.nformacy.com/` origin is down, returns 522).
- The 2026-10-05 refresh added the visual identity rework (ink on paper, one accent, system
  diagrams). SPEC.md records those decisions.
