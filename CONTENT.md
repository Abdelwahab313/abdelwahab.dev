# CONTENT

Single source for what the site says and how it says it. The CV is the source of truth for
facts; this file is the source of truth for site wording. When the two disagree, fix the CV
first, then this file, then `src/data/portfolio.ts` and the page meta in `src/pages/index.astro`.

CV source: `~/projects/playground/Awesome-CV`, the **node variant** (`make node`, LuaLaTeX via
TinyTeX on PATH). Files: `src/resume-node.tex` (title, header), `src/variants/node/{summary,
experience,skills}.tex`, `src/shared/bullets.tex` (every bullet, each macro citing its fact
rows). Every claim traces to a row in `src/fact-sheet.md`, which wins on any conflict. Built
PDF: `out/resume-node.pdf`.

Last aligned: 2026-11-02.

---

## 1. Canonical facts

Every value below appears verbatim in the CV. The site must not vary spelling, casing, dates
or titles.

| Field | Value |
|---|---|
| Name | Abdelwahab Mahmoud |
| Title | Senior Full-Stack Engineer · Node.js, TypeScript, React, AWS |
| Location | Cairo, Egypt |
| Email | abdelwahabahmed93@gmail.com |
| Phone | +20 114 778 4094 |
| Career start | December 2017 |
| Years | "nearly 9 years" (fact row E1; never "9 years", never "8+", never split by stack) |
| GitHub | github.com/abdelwahab313 |
| LinkedIn | linkedin.com/in/abdelwahab313 |
| Site | abdelwahab.dev |

### Employment

| Company | Location | Title | Dates |
|---|---|---|---|
| OnTheGoSystems (WPML) | Remote | Senior Software Engineer | Dec 2024 – Sep 2026 |
| Dailymealz | Riyadh, Saudi Arabia | Senior Software Engineer | Dec 2021 – Dec 2024 |
| Nformacy | Cairo, Egypt | Full-Stack Developer | Oct 2020 – Dec 2021 |
| DevSquads | Cairo, Egypt | Software Engineer | Dec 2017 – Oct 2020 |

Four entries, not five. No role is current; every entry is past tense. The product at
OnTheGoSystems is PTC, its AI translation platform; naming both is fine under the NDA (fact
row O46). The DevSquads line carries no "formerly Fikr Labs" (E1).

### Skills (same rows as the node CV's `skills.tex`)

| Row | Skills |
|---|---|
| Languages | TypeScript, JavaScript, Ruby, Go, SQL |
| Backend & APIs | Node.js, Express, Socket.IO, REST, OpenAPI/Swagger, Apollo GraphQL, Prisma |
| Messaging & Queues | BullMQ, SQS, EventBridge, Step Functions, event-driven architecture |
| Frontend | React, Next.js, React Native |
| Databases | PostgreSQL, MongoDB, Redis, TimescaleDB, DynamoDB |
| Cloud & Infrastructure | AWS (ECS Fargate, Lambda, SQS, ALB, S3), Terraform, Docker, GitLab CI/CD |
| Testing & Observability | TDD, BDD, E2E, Jest, k6, JMeter, Datadog, OpenTelemetry, Prometheus, CloudWatch |
| AI & LLM | Claude Code, Claude Agent SDK, MCP, CrewAI, Bedrock, OpenAI, Gemini, Langfuse, RAG, evals |
| Currently learning | Kafka, Kubernetes |
| Spoken Languages | English, Arabic (native) |

Go is a language with no shipped employer work behind it (E3): it stays out of experience
text, and the Go side projects answer "where did you use Go?". Kafka and Kubernetes are
"Currently learning", never production skills. Not listed anywhere: PHP, Java, MySQL, Aurora,
ClickHouse, Playwright, Cypress, RSpec, Kubernetes-as-skill.

---

## 2. Tone

The CV is terse and third person. The site is first person and a little warmer. Same facts,
same numbers. Positioning follows the node variant: Node.js/TypeScript, React, Next.js and
React Native in the product, the AWS platform, databases and LLM systems underneath.

Framing is done by leaving things out, never by false statements. Experience text and tags
never name Rails, Ruby, Delayed Job, Laravel or PHP, and never state that an employer used a
single stack. "The monolith", not "the PHP monolith". Blog posts whose substance is Rails
keep their code and tags; only facts get fixed there.

Rules, in priority order:

1. **Past tense for every job.** No role is current, so every bullet is past tense.
2. **Concrete over abstract.** A bullet names a system, a change, and why. "Built full-stack
   features across the translation pipeline" says nothing. "Moved production from EC2 onto
   ECS Fargate" says something.
3. **Every number comes from the fact sheet, said the way a person would say it.** Do not add
   a number the fact sheet does not carry. Round to conversational precision where the figure
   stays recognisable: "about a thousand calls", "7 million rows", "a two-hour job". A figure
   like 1,013 or 1h 42m reads as generated, not measured. Headline scale figures stay as the
   CV states them (100K jobs/hour peak, ~5K baseline, 100K daily active users, 30%, over 200,
   2,510, 300, 7 ms, 20,067). Write "peaked at", never "sized for".
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
    "Devsquads", "OTGS" in copy.
11. **Fact-sheet guards that bite on this site.** The triage platform was built with the team
    lead, never "solo" or "alone", and carries no MTTR or speed effect (O9, O11). The Dailymealz
    database is PostgreSQL (D4). Socket.IO ran as a single instance (D3). Fulfilment was one
    service, the Node.js order service, with the monolith as system of record (D9, D27). The
    Aurora CPU incident was one incident, not a backlog (O26). The AI translation platform
    really was Aurora MySQL (O1): the Aurora post and the triage post keep it.
12. **CV stays canonical until told otherwise.** Never "fix" the site by inventing a fact the
    CV lacks (Shell scripting is the standing example: real, but not on the CV, so not on the
    site). The only way to add such a fact is to update the fact sheet and CV first.

---

## 3. Site copy

Paste-ready. Keys refer to `src/data/portfolio.ts` unless noted.

### Hero (`greeting.title`, `greeting.subTitle`, `greeting.valueProp`)

Title: `Abdelwahab Mahmoud`

Subtitle (role line): `Senior Full-Stack Engineer · Node.js, TypeScript, React, AWS`

Value line:

> I build and run production systems end to end, from React in the browser to AWS
> underneath. Most recently I built the LLM engine and the cloud platform behind PTC, the AI
> translation platform at OnTheGoSystems, where the job queues peaked at 100K jobs an hour.

No quick-facts row in the hero: location, years and languages live once, in the About fact
card (`Location`, `Core stack` = "Node.js, TypeScript, React, AWS", `Experience` = "nearly 9
years", `Languages`).

Actions: Resume (`/resume.pdf`), GitHub, LinkedIn, Email (`#contact`). No availability badge,
no code card and no product card in the hero.

No post links in the hero: the front page brands a senior engineer, not a blog. The
homepage Writing section further down shows the three newest posts.

### Meta (`src/pages/index.astro` title and description)

Title: `Abdelwahab Mahmoud | Senior Full-Stack Engineer, Node.js, TypeScript, React, AWS`

Description:

> Senior full-stack engineer in Cairo, nearly 9 years in production. Node.js, TypeScript,
> React, Next.js, React Native, AWS (ECS Fargate, Lambda, Terraform), LLM platforms on
> Bedrock, OpenAI, Gemini.

### About (`src/pages/index.astro`)

Three paragraphs. Career start 2017 on Extreme Programming teams; the stack paragraph names
React, Next.js and React Native in the product, Node.js services behind it, the AWS platform
and databases underneath; the third paragraph is how incidents are handled.

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
- `descBullets` hold every remaining CV bullet, hardest first, in the wording of
  `src/shared/bullets.tex` adapted to first person. Together, story and bullets carry every
  fact of the CV entry.
- More than four bullets show three and a "Show N more" toggle; four or fewer show all.

| Company | headline | product | article |
|---|---|---|---|
| OnTheGoSystems (WPML) | Ran AI translation queues that peaked at 100K jobs an hour without scale-in killing a job mid-run | none | `scaling-ecs-workers-on-queue-depth-without-killing-long-jobs` |
| Dailymealz | Moved fulfilment into the Node.js order service while 100K daily users kept ordering | Dailymealz, `https://dailymealz.com/` | `extracting-fulfillment-from-a-php-monolith-over-sqs` |
| Nformacy | Took a two-sided marketplace from empty repo to beta launch | Nformacy, `https://nformacy.com/` | `building-a-booking-marketplace-from-empty-repo-to-beta` |
| DevSquads | Built Shapa's scale link, recommender and dashboards test-first, and mentored teams adopting XP | Shapa, `https://home.myshapa.com/` | none |

Source: `src/variants/node/experience.tex` and the macros it names in `src/shared/bullets.tex`
(aligned 2026-11-02). Order within an entry is the site's choice; the facts are the CV's.
Two OnTheGoSystems bullets predate the fact sheet and are not backed by a row (the
authorization architecture and the backwards-compatible APIs); they stay until the author
rules on them.

#### Timeline metadata (`duration`, `location`, `tags` on each entry)

The experience section renders as a vertical timeline. Each entry carries a duration and a
short location next to the date, and a row of tech chips under the text. Duration is the
month difference between the two dates. Tags may only name tech that already appears in that
entry's own description or bullets.

| Company | duration | location | tags |
|---|---|---|---|
| OnTheGoSystems (WPML) | 1 yr 9 mo | Remote | Node.js, TypeScript, ECS Fargate, Lambda, Terraform, DynamoDB, Bedrock, Claude Agent SDK, MCP |
| Dailymealz | 3 yrs | Riyadh | Node.js, TypeScript, Socket.IO, React Native, Next.js, SQS, BullMQ, Redis, PostgreSQL, AWS, Datadog |
| Nformacy | 1 yr 2 mo | Cairo | React, BDD, CI/CD |
| DevSquads | 2 yrs 10 mo | Cairo | React, React Native, TDD |

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

> Case studies and notes from nearly 9 years building production systems. What was there,
> what I decided, what it cost, and what changed.

Slugs and URLs are published links and do not change. Titles change only when a title is
factually wrong. Posts whose substance is Rails (`handling-llm-rate-limits-as-reschedules-not-errors`,
`making-llm-triage-verdicts-testable-in-code`, `building-a-booking-marketplace-from-empty-repo-to-beta`,
and the Ruby sketch in `scaling-ecs-workers-on-queue-depth-without-killing-long-jobs`) keep
their code and tags.

Posts name no employer or product (docs/BLOG.md rule 3) and keep only the names of public
tooling (AWS services, OpenAI, Bedrock, Gemini, Langfuse).

### Open source (`openSource.projects`)

Four public repositories, rendered after Writing. Copy lives in
`src/data/portfolio.ts` `openSource`. Each card shows the repo name, description,
`role · outcome`, a GitHub link and tech tags. Named repos, links and descriptions are the
author's real repos; do not invent new ones here without a matching repository. Go tags on
`ecs-drain-scaler` are real Go.

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

| Fact | CV (`~/projects/playground/Awesome-CV/src/`) | Site |
|---|---|---|
| Title line | `resume-node.tex` `\position` | `greeting.subTitle`, `index.astro` title and description, `CONTEXT.md` Positioning |
| Summary | `variants/node/summary.tex` | `greeting.valueProp`, About paragraphs |
| Jobs, titles, dates | `variants/node/experience.tex` | `workExperiences.experience[]` |
| Experience bullets | `shared/bullets.tex` (macros named in `experience.tex`) | `workExperiences.experience[].story` and `.descBullets` |
| Skills | `variants/node/skills.tex` | `cvStack` (chip groups in the Skills section, `knowsAbout` in `src/lib/schema.ts`) |
| Email, phone | `shared/preamble.tex` header | `socialMediaLinks.gmail`, `contactInfo` |
| Education | `shared/education.tex` | `educationInfo` |
| Years figure | `variants/node/summary.tex` | About fact card, blog index description, `CONTEXT.md` Positioning |
| Every claim | `fact-sheet.md` | everything above and every blog post |

Resume button (`greeting.resumeLink`) points at `/resume.pdf`, which is `public/resume.pdf`
in this repo and ships with every build as `https://abdelwahab.dev/resume.pdf`. On every CV
build, copy `out/resume-node.pdf` from the CV repo over `public/resume.pdf` and redeploy.

---

## 5. Open items against the live site

- 2026-11-02 node-variant alignment: title, years, employer names, skills rows, all four
  experience cards, the `/work` challenge cards and the blog facts (100K peak, PostgreSQL at
  Dailymealz, triage built with the team lead and no MTTR effect, fulfilment inside the order
  service, single Socket.IO instance) now mirror the node CV and `fact-sheet.md`. Claims on
  the site with no fact-sheet row were left in place and listed for the author.
- 2026-10-15 blog and work expansion: `/blog` gained tag chips with counts, a
  client-side search and filter, cover thumbnails and the featured card
  (`scaling-ecs-workers-on-queue-depth-without-killing-long-jobs` carries `featured: true`). New frontmatter: `featured`, `cover`,
  `coverAlt` (docs/BLOG.md). Three case studies shipped
  (`extracting-fulfillment-from-a-php-monolith-over-sqs`, `building-a-booking-marketplace-from-empty-repo-to-beta`, `live-order-status-over-socket-io-and-redis`), all six
  challenge cards' `article` fields are filled, `/work` is a real route, the
  nav's Work item points there, and `/atom.xml` joins `/rss.xml`.
- 2026-10-11 redesign (docs/mockup-review.md, mockup v2): availability signals, the stat band
  and the hero Code card are removed; Products became dossier cards; Skills became chip
  groups; Writing links to `/blog`. No job is current and every bullet is past tense.
- 2026-10-08 Astro rebuild (branch `astro-rebrand`, ADR 0001): the site moved from the CRA
  fork to Astro. Blog posts are `.md` files in a content collection. URLs (`/`, `/blog`,
  `/blog/{slug}`), the domain and `/resume.pdf` are unchanged. The site is served by Netlify
  from `main` (`netlify.toml`).
- Case studies moved off the homepage into `/blog` on 2026-10-08, alongside future articles.
  Authoring contract: `docs/BLOG.md`.
- Nformacy product link is `https://nformacy.com/` (the old
  `https://beta.nformacy.com/` origin is down, returns 522).
- The 2026-10-05 refresh added the visual identity rework (ink on paper, one accent, system
  diagrams). SPEC.md records those decisions.
