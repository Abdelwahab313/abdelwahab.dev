# Prompt: rewrite blog posts into story mode

You are editing technical posts for this portfolio. Follow the repo constraints
strictly. This file is the editor's brief and the paste-ready prompt.

## References

- Voice: `CONTENT.md` section 2 (tone rules). Schema: `docs/BLOG.md` and
  `src/content.config.ts`.
- Number provenance: `SPEC.md` section 8 (fact trace). The four migrated posts
  keep numbers the CV retired on 2026-10-06 by explicit decision.
- Editorial ideas live in the Notion database (link in the old brief). Check it
  before creating or reshaping a post, and align with existing notes/tags.

## Constraints (never violate)

- Read `CONTENT.md` and `docs/BLOG.md` first.
- No em dashes in prose. Full stop or comma. (Company/product names quoted
  verbatim from the CV are the only exemption.)
- Every number must trace to a CV branch or `SPEC.md` section 8. Do not invent
  metrics, percentages, dates or counts. Do not restate a number at a new
  precision.
- Anonymous unless agreed. No employer or product names in a post, no
  `product`/`link` frontmatter, no `employer` URL. Only public tooling names
  survive: AWS services, Bedrock, OpenAI, Gemini, Langfuse.
- First person, past tense for finished work. Match the site voice.
- Schema:
  - `note`: `kind: note`, `status`, `date`, `order`, `lede` (<=160),
    `tags[]`, `sections: [{heading, paragraphs[]}]`.
  - `case-study`: same base plus required `situation`, `decision`, `tradeoff`,
    `outcome` (one string each) and optional `diagram`, `diagramCaption`,
    `product`, `link` (only when valid).
- No filler. No buzzwords. No self-help cliches. No exclamation marks.

## Style review: where the current posts stand

The four migrated posts already carry a real narrative: symptom, the obvious
fix, why it was wrong, the investigation, the change, the cost, the lesson.
That is the right skeleton. What to fix:

1. Hooks are soft. "The database went red" tells the reader nothing they can
   hold. Lead with the concrete and the stake in one line.
2. Constraints are the strongest part. Keep them, and name the trade in plain
   words ("a few idle minutes" against "up to 2 hours of lost work").
3. The moment of realization is buried. `aurora` has it ("The plan examined
   7.33 million rows per call. That number changed the problem."). Make every
   post show the line that flipped the diagnosis.
4. Outcome sections drift into summary. State the verified result, then stop.
   Do not restate the whole post in the lesson.
5. Repetition of sentence shape across posts ("X. It was also the wrong one.",
   "That is the trade."). Vary rhythm; one short sentence beat per post, not
   three.
6. `kind` is inconsistent with the docs. `docs/BLOG.md` and `CONTENT.md`
   section 3 call `fargate`, `engine`, `aurora`, `triage` the migrated case
   studies, but all four files say `kind: note`. Decide one, fix both the files
   or the docs. The `case-study` schema is four flat strings with no subheads,
   so a 5 to 10 minute read under that shape is one wall of text per part.
   Recommendation: keep long posts as `note` (sections give pacing) and update
   the docs to say so, or extend the schema before migrating them.

## The narrative arc

Use this shape. Not every post needs every beat, but the order holds.

1. Hook. The impact, in one or two lines. What broke, what it cost, who felt
   it. Concrete over dramatic.
2. Context. Only what the reader needs to follow the rest. Two sentences max.
3. Symptom. What showed up before you understood it. Resist diagnosis here.
4. Constraints. The tradeoffs that ruled out the obvious fix. This is the
   section that makes a post worth reading. State why the cheap answer failed.
5. Investigation. How you actually learned the cause. The one measurement or
   query or trace that changed your mind.
6. Decision. The choice, and why over the alternatives you just ruled out.
7. Change. The minimum implementation detail needed to understand the decision.
   No diff, no PR log, no tutorial.
8. Outcome. Only the verified result. If there is no number, say what changed
   without inventing one.
9. Lesson. One transferable rule. Concrete, second person, one or two
   sentences.

Rules of engagement:

- Why before how. Impact before mechanism.
- Short paragraphs. One idea each.
- Show the constraints that made the obvious fix wrong. That is the story.
- Cut any sentence that only signals competence ("I owned that", "I led the
  effort") unless it carries a constraint or a number.
- No "we built X" openings. No generic process narration.

## Before / after examples

### aurora.md

Before (opening):

> "Aurora MySQL sat at 100% CPU and stayed there. Requests that were fine
> before started queuing, and the whole product felt it, not just the feature
> that caused it."

After:

> "One status broadcast was running 1,013 queries and the database answered by
> pinning to 100% CPU. Requests that were fine an hour earlier started queuing,
> and the whole product felt it, not just the feature that caused it."

Before (constraints, kept but sharpened):

> "The instinct was to tune the query. Add an index, raise the instance size,
> cache harder. None of those were safe bets. I was guessing at a cause."

After: keep, then add the stake:

> "The instinct was to tune the query: add an index, raise the instance size,
> cache harder. All three were guesses. An index does nothing if the query is
> not using one, and a bigger instance buys time by hiding the cause. I also
> could not take the broadcast down. Clients needed fresh status. The goal was
> to keep the whole system up, not to protect the database by breaking a
> feature."

Before (realization, already good, keep as the pivot):

> "I ran EXPLAIN on the broadcast query instead of guessing. The plan examined
> 7.33 million rows per call. That number changed the problem."

Lesson stays. It is one rule, second person, testable.

### fargate.md

Before (hook):

> "A translation could run anywhere from 30 seconds to 2 hours. When the worker
> fleet scaled in, ECS stopped tasks without asking. If a task was mid-job, that
> work was gone."

After:

> "A scale-in event could delete two hours of finished work. The default
> autoscaler watched CPU and memory, and for this workload a worker blocked on
> a slow provider call looks idle. So ECS stopped it mid-translation and the
> job started over from zero."

Before (constraints, keep, tighten the trade):

> The three paragraphs already do the work: cannot stop scaling, cannot make
> every job resumable without a quarter-long rewrite, cheap options are worse.
> Keep all three. Then state the trade once, explicitly.

Outcome/cost stays: "a few idle minutes on shutdown" against "up to 2 hours of
work". That is the sentence a reader remembers.

### engine.md

Before (hook):

> "The translation flow ran on LLM calls, and it was metered: credits,
> ordering and cost all mattered. When I looked at why reviews failed, rate
> limit errors were behind 65% of them."

After:

> "Almost two thirds of failed reviews were not broken translations. They were
> rate limits. 65% of review failures came back as a throttled provider, and
> every one of them surfaced to the user as our product being down."

Before (the false fix, keep the rhythm but cut one beat):

> "The obvious answer was to retry. It was also the wrong one. Retrying a
> throttled call does not make the provider less busy. It makes you noisier."

After:

> "The obvious answer was to retry, which does not make the provider less busy,
> only louder. With three providers, each with its own limits and failure
> shapes, 'if 429 then' scattered across the codebase leaked every quirk into
> every caller."

The constraint line ("a provider outage could not become our outage") is the
hook of the whole post. Move it up if the lede does not already say it.

Credits paragraphs: keep both numbers (7 millisecond race, four ADRs). They are
the "implementation detail only where necessary" beat.

### triage.md

Before (hook):

> "I was looking at production incidents and wanted to triage them before
> pulling a human in. An LLM could read the logs, summarize what happened, and
> sound convincing. That was the whole problem."

After:

> "The most dangerous output from a triage agent is a confident pass. I built
> one to read incident logs and summarize what happened, and it was convincing.
> Convincing is not correct, and the platform was about to treat it as
> correct."

Before (realization, already the best line in the set):

> "I could tune the words, but I could not point at the exact check that decided
> pass or fail, and I could not test it."

Keep. This is the investigation beat: prompt-only was a dead end because it was
unprovable.

Outcome: "three false passes caught by replaying old incidents" is the verified
number. Do not inflate it. The lesson ("go/no-go as a unit-testable function,
not a sentence") stays.

## Personal and meta posts

Write one rarely. The portfolio's value is the systems, not the author's
feelings about them. A personal post earns its place only when it carries the
same specificity as a case study.

When to write one:

- A career decision with a concrete shape: why you left, why you took the role,
  what you optimized for. Facts, dates, reasoning. Not vibes.
- A method you actually changed after being wrong. The before and after of how
  you work, with a specific incident as the anchor.
- The state of the blog or site itself, once, if it explains a real tradeoff
  (why Astro, why anonymous posts).

How to keep it separate from case studies:

- Keep `kind: note`. Do not give it `product`, `link` or `diagram`.
- Tag it `meta` or `career` so it is filterable later.
- Anchor every meta post on one concrete event. No post that is only opinion.

What to avoid:

- Self-help cliches: "lessons I learned", "the one habit that", "level up".
- Fake vulnerability with no stakes. If the story cannot be told with real
  numbers and real decisions, do not tell it.
- Advice you have not followed yourself.

## Index and preview tweaks

- `src/pages/blog/index.astro` has drifted from `CONTENT.md` section 3. The
  heading renders as "Writing" and the subtitle reads "Notes and case studies
  from building production systems. What was tried, what cost, and what
  changed." `CONTENT.md` sets the title to `Blog` and a different subtitle
  ("Four systems from the last two years, plus whatever comes next...").
  Pick one source and align both. The page meta description already differs
  from both.
- The lede is the only hook a reader sees on `/blog`. Treat it as the opening
  line of the story, not a summary. Current ledes are good; keep them under
  160 and lead with the concrete number or the stake.
- Titles are strong and specific (`7.33M rows per call`, `Draining, not
  stopping`). Keep titles short and concrete; put the stake in the lede.
- Consider a one-line "constraint" snippet or a reading-time label on the row
  so a reader can tell a five-minute investigation from a two-minute note.
  Optional, not required by the schema.
- Drafts already show a `Draft` badge and are filtered in production. Leave
  that path alone.

## Reusable rewrite prompt (paste this)

```
Rewrite the post at src/content/blog/<slug>.md into story mode. Do not invent
facts. Return the full revised markdown plus a three-line rationale.

Read first: CONTENT.md (voice), docs/BLOG.md (schema), SPEC.md section 8
(number provenance). Read the current post and the other three for voice.

Arc to follow, in order:
1. Hook: impact and stake in one or two lines. Concrete, not dramatic.
2. Context: only what the reader needs. Two sentences max.
3. Symptom: what showed up before the cause was known.
4. Constraints: the tradeoffs that ruled out the obvious fix. Strongest beat.
5. Investigation: the one measurement, query or trace that changed the
   diagnosis.
6. Decision: the choice and why, over the alternatives just ruled out.
7. Change: minimum implementation detail. No diff, no PR log.
8. Outcome: only the verified result. No empty metric if none exists.
9. Lesson: one transferable rule, second person, one or two sentences.

Constraints:
- No em dashes in prose. Full stop or comma.
- Every number traces to the CV or SPEC.md section 8. Add nothing.
- Anonymize employer and product. Only public tooling names.
- First person, past tense for finished work.
- Keep status, date, order, tags. Update lede only to sharpen the hook (<=160).
- Short paragraphs, one idea each. No buzzwords, no filler, no exclamation
  marks, no self-help cliches.
- Keep the schema valid: note uses sections[{heading, paragraphs[]}];
  case-study uses situation/decision/tradeoff/outcome and an optional diagram
  with caption.

Checklist:
- [ ] Lede is the hook and is concrete.
- [ ] Constraints and tradeoffs are explicit.
- [ ] Why is explained before how.
- [ ] The realization line is present and specific.
- [ ] No invented numbers or precision.
- [ ] No em dashes, no banned phrases, no exclamation marks.
- [ ] Schema validates (`npm run build`).
- [ ] 5 to 10 minute read where the material supports it, no padding.
- [ ] Outcome states only what is verified.
- [ ] Anonymity preserved.
```
