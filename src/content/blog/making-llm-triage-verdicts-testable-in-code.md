---
title: "Making LLM triage verdicts testable in code"
kind: note
status: published
date: 2026-09-12
order: 4
lede: Prompting an LLM to be careful never made pass/fail testable. Moving the verdict into code did, and replaying old incidents caught three false passes.
tags: [agents, llm, rails]
cover: /img/blog/triage.svg
coverAlt: An agent box hands evidence to a small solid verdict box, while its dashed write path is blocked by a human gate.
---

## A convincing summary is not a correct one

I was looking at production incidents and wanted to triage them before pulling a human in. An LLM could read the logs, summarize what happened, and sound convincing. That was the whole problem, because the platform was about to treat 'convincing' as 'correct'.

The platform took first-line incident and support inquiries. I built it alone over three months, and the part that took longest to get right was not the investigating. It was deciding who gets to say "this is fine".

## A false pass costs more than a false alarm

Triage can be wrong in two directions, and they do not cost the same. A false fail sends something harmless to a person, who confirms it is harmless and closes it. A false pass closes something that was not fine, and nobody looks again, because the system said nobody needed to. The problem comes back later from somewhere else, with the logs older and the trail colder.

Mean Time To Resolve was the number I wanted to move, but not by making the wrong call faster. An agent that closes everything instantly has an excellent MTTR right up until someone audits what it closed. So the target was lopsided on purpose. A fail is cheap: it means a human looks. A pass has to be earned.

My first attempt was prompt-only. I asked the agent to be cautious and explain its reasoning. The reasoning got better. The boundary between a real pass and a hopeful one stayed fuzzy.

I could tune the words, but I could not point at the exact check that decided pass or fail, and I could not test it. When the agent passed an incident, the reason was somewhere inside a paragraph of prose. When I changed the prompt to fix one case, I had no way to know which other cases had moved with it.

The obvious next move is a confidence score with a threshold, and I think that moves the fuzziness into a number without removing it. OpenAI's GPT-4 technical report measured calibration on the model's token probabilities and found that "the post-training hurts calibration significantly", and a confidence number the model writes into its own answer is one step further from anything measured.

## The model gathers, code decides

I kept the agent for what it is good at: reading, reasoning, and collecting evidence. I moved the pass/fail decision itself into code, into checks I could test and replay.

The agent investigated through an MCP server that exposed live databases, logs and selected APIs to the team's agents through authenticated, monitored access. Access was read-only, every action was written to an audit log, and any write to production sat behind a gate only a human could open. The MCP spec says there should always be a human in the loop able to deny a tool call, and for production writes I treated that SHOULD as a must.

Read-only has to live in the database user. The MCP schema calls `readOnlyHint` a hint, and it enforces nothing. The rollback wrapper around data access is a second line, because it only undoes what the database can roll back. The first line is a credential that cannot write. That server outlived the triage use and became the team's standard agent integration path.

![The split. An inquiry goes to the agent, which calls read-only tools through an MCP server that logs every call. The agent returns a hypothesis and findings that cite audit ids, never a verdict. A tested verdict function reads the tool results from the audit log and answers pass or fail, and any write to production sits behind a gate only a human can open.](diagram:triage-gather-decide)

What changes is the agent's output. It no longer says "pass". It returns a hypothesis and a list of findings, and each finding points at the audit-log entry of the tool call that shows it. The verdict function never reads the agent's prose. It reads the tool results the agent cited, straight from the audit log, and runs a fixed check against each one. Here is the shape, with an illustrative rule:

```ruby
module Triage
  Finding    = Data.define(:fact, :audit_id)
  AuditEntry = Data.define(:result)

  RULES = {
    transient_upstream_timeout: {
      job_completed_on_retry: ->(result) { result.dig("job", "state") == "completed" },
      no_recurrence_since:    ->(result) { result.fetch("match_count", nil)&.zero? }
    }
  }.freeze

  def self.verdict(hypothesis:, findings:, audit_log:)
    rule = RULES[hypothesis]
    return :fail unless rule

    earned = rule.all? do |fact, check|
      finding = findings.find { |f| f.fact == fact }
      entry   = finding && audit_log[finding.audit_id]
      entry && check.call(entry.result)
    end

    earned ? :pass : :fail
  end
end
```

The rules matter less than the defaults around them. A hypothesis with no rule fails, so the agent cannot pass an incident by inventing a new kind of explanation. A missing finding fails, so "it has not happened again" counts only if the search that came back empty is in the audit log. The checks run against what the tool returned, not the agent's description of what it returned, so a paraphrase that drifted from the data cannot carry the verdict. There is no confidence input anywhere. The model's certainty has nowhere to go.

Support claims ran through the same platform with a critic agent added to find the hole in the investigator's case, and two agents arguing is still two opinions, which is why I would keep the verdict out of both.

## Replaying old incidents caught three false passes

A verdict function is ordinary code, so it gets ordinary tests. The useful ones are past incidents whose real outcome is already known: the findings the agent produced, the audit entries those findings cite, and how the incident actually ended.

```ruby
# spec/triage/replay_spec.rb, one JSON fixture per past incident
RSpec.describe "Triage.verdict replay" do
  Dir[Rails.root.join("spec/fixtures/incidents/*.json").to_s].sort.each do |path|
    incident = JSON.parse(File.read(path))

    it "#{File.basename(path, ".json")} ends as #{incident["actual"]}" do
      findings = incident["findings"].map do |f|
        Triage::Finding.new(fact: f["fact"].to_sym, audit_id: f["audit_id"])
      end
      audit_log = incident["audit"].to_h do |e|
        [e["id"], Triage::AuditEntry.new(result: e["result"])]
      end

      verdict = Triage.verdict(hypothesis: incident["hypothesis"].to_sym, findings:, audit_log:)
      expect(verdict).to eq(incident["actual"].to_sym)
    end
  end
end
```

Replaying old incidents through the checks caught three false passes that a prompt had let through. Three times, the prompt-only agent had called an incident fine and the real outcome said otherwise. Those three are the most valuable fixtures in a suite like this. Any later change to a rule that would let one of them pass again turns its example red.

![The replay. Each past incident is a fixture of findings, audit entries and the real outcome. It runs through the same verdict function as production, with no model call, and the result is compared with what actually happened. A mismatch turns the example red, which is how the three false passes surfaced.](diagram:triage-replay)

There are two replays here, and I would keep them apart. The spec above tests the code against recorded evidence, so it is fast and gives the same answer every time, and it says nothing about whether the agent would find that evidence again. Re-running the agent on the same incidents is the other replay. That one is an evaluation, and because the model is not deterministic, the useful question is how often it gathers the findings a rule needs.

If your traces already live in Langfuse, its datasets fit that second replay: `create_dataset_item()` takes a `source_trace_id` that links an item back to its production trace, and `run_experiment()` runs a task function over the items. A red RSpec example means the rules changed, and a drop in the evaluation means the agent did. Mixing the two makes both signals harder to read.

## What the narrow verdict costs

The verdict function is narrow on purpose, and every kind of pass needs a rule someone wrote by hand. When the agent finds a real, harmless cause that no rule describes, the answer is still fail, and a human reads a correct draft and closes it. The automation covers exactly as much ground as the rules do, and on a solo build the rules grow at the speed of one person.

Rules also encode how the system looks today. A renamed job state or a changed log format can make a check stop matching. Written like the rule above, where a missing field is falsy, that drift turns into more fails and more human work, never into a false pass. Written carelessly, with a check that treats a missing count as zero, it drifts the other way. That is the bug in this design I would look for first in a code review.

All of this is the wrong design when being wrong is cheap. If an agent only routes or labels inquiries and a person reads every one anyway, a prompt is enough and a rule table is overhead. The cost of a wrong answer decides how much of the decision has to leave the prompt.

## Make the go/no-go a function

The platform cut Mean Time To Resolve across incident and support inquiries because a human started from a drafted answer and its evidence instead of an empty screen.

Pick the one decision in your agent pipeline that closes something without a person looking. If you cannot write the RSpec example that goes red when that decision is wrong, the model should not be making it alone.

## Sources

- OpenAI, GPT-4 Technical Report, calibration and Figure 8: https://cdn.openai.com/papers/gpt-4.pdf
- Model Context Protocol, Tools (2025-06-18): human in the loop, security considerations: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- Model Context Protocol, Schema reference (2025-06-18), `ToolAnnotations` and its defaults: https://modelcontextprotocol.io/specification/2025-06-18/schema
- MySQL 8.0 Reference Manual, Statements That Cause an Implicit Commit: https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html
- Langfuse, Datasets: https://langfuse.com/docs/evaluation/dataset-runs/datasets
