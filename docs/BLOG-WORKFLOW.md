# Blog workflow (agentic pipeline)

How a blog post gets from an idea to a published file on this site. The
authoring contract for a single post is `docs/BLOG.md`. This file is the
pipeline around it: three agents, one orchestrator, and a retry policy.

Entry point: the `/blog` command (`.opencode/command/blog.md`), run from the
main session. The main session is the orchestrator. The three agents live in
`.opencode/agents/` and are spawned with the Task tool as subagents.

```
idea ──> blog-researcher ──> dossier ──> blog-writer ──> draft ──> blog-reviewer ──> verdict
                                   (orchestrator persists artifacts and routes retries)
```

## Priorities

1. Correctness. Every claim traceable to a source.
2. Context and value delivered. The reader walks away able to do or decide
   something new.
3. The five-minute core: lede, headings and front-loaded paragraphs let a
   reader grasp the argument in about five minutes of reading.
4. One person wrote it. The post has an opinion, uneven sections, first
   person that is earned, and none of the scaffolding (body TOC, numbered
   steps, FAQ, takeaways recap, `Key insight` callouts, colon-list title)
   that marks a generated post. The full list lives in
   `.opencode/agents/blog-writer.md`, "One person wrote this"; the reviewer
   measures it in its "One-person check".

The reference for what *not* to do is a high-volume technical blog that
publishes one formula post per day: impersonal, `Step N:` headings, a bold
`Key insight:` after every section, FAQ plus `Key Takeaways` at the end, and
internal contradictions nobody caught (assessed 2026-10-16). The reference for
what to do is a post that names a real constraint, what was tried, why the
winner won, what it cost, and where the author stands.

Length budget: lede plus body, code included, at most 1,800 words, so the
page shows 9 min or less (decided 2026-10-27; every post before that ran 13
to 23 min). One story per post. Breadth that does not fit is a spin-off for
`docs/blog/ideas.md`, not a reason to go over. The writer and reviewer agent
files carry the rule and the reviewer reports the count.

## Stages

### 1. Research (`blog-researcher`, read-only)

Input: the topic or idea. The researcher reads the contract and tone rules,
verifies facts against primary sources, ranks angles, and returns a dossier
in the fixed format defined in its agent file.

Orchestrator actions:

- Spawn `blog-researcher` with the topic.
- Persist the returned dossier to `docs/blog/research/<slug>.md` (create the
  directory on first use). The slug comes from the dossier.
- Check the slug against existing ids in `src/content/blog/`; on a collision,
  ask the researcher for a new slug before persisting.
- If the dossier's opening paragraph kills the idea (stale, wrong, covered
  better elsewhere), stop and report that to the user. Killing a bad idea is
  a valid pipeline outcome.

### 2. Write (`blog-writer`)

Input: the dossier path, the slug, the target file
`src/content/blog/<slug>.md`. The writer reads the dossier, the contract, the
tone rules and two existing posts, then writes the post as `status: draft`.

Orchestrator actions:

- Spawn `blog-writer` with the dossier path and slug.
- Confirm the post file exists and run `npm run build`. A schema failure goes
  back to the writer in the same task (see retries).

### 3. Review (`blog-reviewer`, read-only)

Input: the draft path and the dossier path. The reviewer fact-checks, checks
structure and value, lints voice against `CONTENT.md` section 2, and returns
a review with a verdict: SHIP, REVISE, or REJECT.

Orchestrator actions:

- Spawn `blog-reviewer` with both paths.
- Persist the review to `docs/blog/reviews/<slug>.md`.

## Retry policy

The orchestrator retries; the agents do not loop on their own.

| Failure | Retry | Max |
|---|---|---|
| Dossier has load-bearing claims without sources | Re-run `blog-researcher` with the specific gaps listed | 1 |
| Build/schema failure | Send `blog-writer` the exact schema error in the same task | 2 |
| Review verdict REVISE | Send `blog-writer` the review's Blockers (and Should fix) verbatim, as a revision task on the same file | 2 cycles |
| Review verdict REJECT | Send `blog-researcher` the reviewer's "what should be re-researched" note as a new research task | 1 |
| Review One-person check finds an UNTRACEABLE first-person event | Send `blog-writer` the quote; it is rewritten as what the source says, or cut. Never ask the user to "confirm" an anecdote the pipeline invented | - |
| Review fact-check FAIL or UNVERIFIABLE on a dossier-sourced claim | Send `blog-researcher` the specific claim to re-verify (corrected source or corrected fact), then `blog-writer`; the writer cannot fix a claim the dossier never supported | 1 |
| Writer reports dossier items marked `needs author confirmation` | Ask the user directly; never guess | - |

After the retry budget is spent, stop and surface the open items to the
user. Do not keep cycling agents to chase a verdict.

## Publishing

1. Verdict SHIP, and the user has read the draft.
2. Flip `status` to `"published"` (the user confirms; the orchestrator may do
   the edit on request).
3. `npm run build`, then `npm preview` and check `/blog/<slug>` returns 200.
4. Deploy. Details in `docs/BLOG.md`.

## Idea backlog

`docs/blog/ideas.md`. When the pipeline produces spin-off ideas (open
questions worth their own post, angles not taken), append them there. The
`/blog` command reads it when no topic is given.

## Artifacts

| Artifact | Path | Written by |
|---|---|---|
| Idea backlog | `docs/blog/ideas.md` | anyone |
| Research dossier | `docs/blog/research/<slug>.md` | orchestrator, from researcher output |
| Post draft | `src/content/blog/<slug>.md` | `blog-writer` |
| Review report | `docs/blog/reviews/<slug>.md` | orchestrator, from reviewer output |

Dossiers and reviews are workflow artifacts, not site content. They stay out
of `src/content/blog/` so the content collection never picks them up.

## Standing decision: numbers from outside the CV

`CONTENT.md` section 2 rule 3 (every number from the CV) is written for
claims about the author's own work, and stays absolute for those claims.
For learning-topic posts about external systems, a number may enter a post
only if the researcher verified it against a first-party source and the
dossier carries that source reference (a URL, or a repo path pinned to a tag
or commit). Anything else is out.
