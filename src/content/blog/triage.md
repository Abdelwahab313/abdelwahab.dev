---
title: The triage agent that almost shipped a false pass
kind: note
status: published
date: 2026-09-12
order: 4
lede: Prompting an LLM to be careful never made pass/fail testable. Moving the verdict into code did, and replaying old incidents caught three false passes.
tags: [agents, llm, rails]
cover: /img/blog/triage.svg
coverAlt: An agent box hands evidence to a small solid verdict box, while its dashed write path is blocked by a human gate.
---

## An answer that felt right

I was looking at production incidents and wanted to triage them before pulling a human in. An LLM could read the logs, summarize what happened, and sound convincing.

That was the whole problem. A convincing summary is not a correct one, and the platform was about to treat 'convincing' as 'correct'.

The platform took first-line incident and support inquiries. I built it alone over three months, and the part that took longest to get right was not the investigating. It was deciding who gets to say "this is fine".

## A false pass costs more than a false alarm

The failure mode I cared about was not a bad summary. It was a confident pass.

Triage can be wrong in two directions, and they do not cost the same. A false fail sends something harmless to a person, who confirms it is harmless and closes it. A false pass closes something that was not fine, and nobody looks again, because the system said nobody needed to. The problem comes back later from somewhere else, with the logs older and the trail colder.

Mean Time To Resolve was the number I wanted to move, but not by making the wrong call faster. An agent that closes everything instantly has an excellent MTTR right up until someone audits what it closed.

So the target was lopsided on purpose. A fail is cheap: it means a human looks. A pass has to be earned.

## Asking the model to be careful

My first attempt was prompt-only. I asked the agent to be cautious and explain its reasoning. The reasoning got better. The boundary between a real pass and a hopeful one stayed fuzzy.

I could tune the words, but I could not point at the exact check that decided pass or fail, and I could not test it. When the agent passed an incident, the reason was somewhere inside a paragraph of prose. When I changed the prompt to fix one case, I had no way to know which other cases had moved with it. That is a bad place to stand when the cost of being wrong is high.

The obvious next move is to ask the model for a confidence score and put a threshold on it. I think that moves the fuzziness into a number without removing it. The cleanest evidence I know is in OpenAI's GPT-4 technical report. The pre-trained model was "highly calibrated (its predicted confidence in an answer generally matches the probability of being correct)". After post-training, "the calibration is reduced", and the figure caption is blunter: "The post-training hurts calibration significantly." That was measured on the model's token probabilities for multiple-choice questions from MMLU. A confidence number the model writes into its own answer is one step further from anything measured, and the report does not test it. I would not hang a decision boundary on either.

## Read-only is a property of the credential

Before the verdict could move anywhere, the agent needed a way to investigate that could not hurt production. That became its own piece of work: an MCP server that exposed live databases, logs and selected APIs to the team's agents through authenticated, monitored access. Access was read-only. Data access ran behind a rollback wrapper, every action was written to an audit log, and any write stayed behind a gate only a human could open.

MCP's value here is that the tool surface is explicit. A client asks the server for `tools/list`, and each tool comes back as a name, a description, a JSON Schema for its input and, optionally, a schema for its output. The agent can call what is listed, with arguments that validate, and nothing else. A narrow tool looks like this, as a sketch with illustrative names:

```json
{
  "name": "find_job",
  "title": "Look up one job by id",
  "description": "Returns the current state and last error of a single job. Read-only.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "job_id": { "type": "string", "description": "The id from the exception payload" }
    },
    "required": ["job_id"]
  },
  "annotations": {
    "readOnlyHint": true,
    "openWorldHint": false
  }
}
```

The `annotations` block is the part people over-read. `readOnlyHint: true` does not make a tool read-only. The MCP schema says every property of `ToolAnnotations` is a hint, "not guaranteed to provide a faithful description of tool behavior", and that clients should never make tool-use decisions based on annotations from untrusted servers. The default for `readOnlyHint` is `false`. The annotation tells a client how to present the tool. It enforces nothing.

So read-only has to live below the protocol. The spec's security section puts the burden on the server: it must validate all tool inputs, implement proper access controls, rate limit invocations and sanitize outputs. Clients should log tool usage for audit. In a Rails app it is tempting to reach for the framework's own guard, something like this sketch:

```ruby
# A sketch of the approach, not the production code.
module ReadOnlyGate
  def self.call(tool, args)
    result = nil
    ActiveRecord::Base.while_preventing_writes do
      ActiveRecord::Base.transaction do
        result = TOOLS.fetch(tool).call(**args)
        raise ActiveRecord::Rollback # undo what the tool did, where the database can undo it
      end
    end
    result
  ensure
    AuditLog.append(tool: tool, args: args, result: result, at: Time.current)
  end
end
```

Both layers in that sketch are weaker than they look. The Rails API docs say `while_preventing_writes` "does not provide the same protection as a readonly user" and "is meant to be a safeguard against accidental writes". `raise ActiveRecord::Rollback` rolls the transaction back and `transaction` swallows the exception, which is what you want, but a rollback only undoes what the database is able to roll back. On MySQL, which is what Aurora ran for this product, DDL such as `CREATE TABLE`, `ALTER TABLE` and `DROP TABLE` ends the open transaction "as if you had done a COMMIT before executing the statement". A rollback wrapper is the second line. The first line is a database user that cannot write at all.

The client side has a layer too, and it is worth having. The Claude Agent SDK documents the order it checks a tool call in: hooks first, then deny rules, ask rules, the permission mode, allow rules, and last a `canUseTool` callback. A `PreToolUse` hook that returns `permissionDecision: "deny"` blocks the call even in `bypassPermissions` mode, and so does a matching deny rule. Explicit refusals running first is the right order. It is still configuration on the client, though. A credential that cannot write does not depend on anyone having configured the client correctly.

The human-only write gate is the MCP spec's own advice taken literally. The spec says there "SHOULD always be a human in the loop with the ability to deny tool invocations". For writes to production I treated that SHOULD as a must.

## The model gathers, code decides

I kept the agent for what it is good at: reading, reasoning, and collecting evidence. I moved the pass/fail decision itself into code, into checks I could test and replay.

![The split. An inquiry goes to the agent, which calls read-only tools through an MCP server that logs every call. The agent returns a hypothesis and findings that cite audit ids, never a verdict. A tested verdict function reads the tool results from the audit log and answers pass or fail, and any write to production sits behind a gate only a human can open.](diagram:triage-gather-decide)

What changes is the agent's output. It no longer says "pass". It returns a hypothesis and a list of findings, and each finding points at the audit-log entry of the tool call that shows it. The verdict function never reads the agent's prose. It reads the tool results the agent cited, straight from the audit log, and runs a fixed check against each one. Here is the shape as a sketch; the rule and its checks are illustrative, not the real ones:

```ruby
# A sketch of the shape, not the production code. Rule names and fields are illustrative.
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

Support claims went through the same platform, with a second agent added: an investigator that builds the case on a claim, and a critic whose job is to find the hole in it. Two agents arguing is better than one agent agreeing with itself. It is still two opinions, which is why I would keep the verdict out of both of them.

## Replaying old incidents as tests

A verdict function is ordinary code, so it gets ordinary tests. The useful ones are not invented cases. They are past incidents whose real outcome is already known: the findings the agent produced, the audit entries those findings cite, and how the incident actually ended. Replay them through the function and compare.

```ruby
# spec/triage/replay_spec.rb, a sketch. One JSON fixture per past incident.
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

      verdict = Triage.verdict(
        hypothesis: incident["hypothesis"].to_sym,
        findings: findings,
        audit_log: audit_log
      )

      expect(verdict).to eq(incident["actual"].to_sym)
    end
  end
end
```

Replaying old incidents through the checks caught three false passes that a prompt had let through. Three times, the prompt-only agent had called an incident fine and the real outcome said otherwise. Those three are the most valuable fixtures in a suite like this. Any later change to a rule that would let one of them pass again turns its example red.

![The replay. Each past incident is a fixture of findings, audit entries and the real outcome. It runs through the same verdict function as production, with no model call, and the result is compared with what actually happened. A mismatch turns the example red, which is how the three false passes surfaced.](diagram:triage-replay)

There are two different replays here, and I would keep them apart. The spec above is deterministic. It tests the code against recorded evidence, so it is fast and gives the same answer every time. It says nothing about whether the agent would find that evidence again. Re-running the agent itself on the same incidents is the other replay, and it is an evaluation, not a unit test. The model is not deterministic, so the useful question is how often it gathers the findings a rule needs, not whether a single run matches.

If your traces already live in Langfuse, its datasets fit that second replay. A dataset is "a collection of inputs and expected outputs", `create_dataset_item()` accepts a `source_trace_id` so an item links back to the production trace it came from, and `run_experiment()` runs a task function over the items. A red RSpec example means the rules changed. A drop in the experiment means the agent did. Mixing the two makes both signals harder to read.

## What the narrow verdict cost

The verdict function is narrow on purpose, and narrow has a price. Every kind of pass needs a rule someone wrote by hand. When the agent finds a real, harmless cause that no rule describes, the answer is still fail, and a human reads a correct draft and closes it. The automation covers exactly as much ground as the rules do, and on a solo build the rules grow at the speed of one person.

Rules also encode how the system looks today. A renamed job state or a changed log format can make a check stop matching. Written like the sketch, where a missing field is falsy, that drift turns into more fails and more human work, never into a false pass. Written carelessly, with a check that treats a missing count as zero, it drifts the other way. That is the bug in this design I would look for first in a code review.

The agent cannot fix anything, either. Every remediation went through the human-only write gate, which is slower than letting an agent restart a job itself. For production data I would keep it that way.

And all of this is the wrong design when being wrong is cheap. If an agent only routes or labels inquiries and a person reads every one anyway, a prompt is enough and a rule table is overhead. The cost of a wrong answer decides how much of the decision has to leave the prompt.

## The human starts from a draft

The platform handled the first pass, so a human started from a drafted answer and its evidence instead of an empty screen. That is where the time savings came from, not from removing the human. It cut Mean Time To Resolve across both incident and support inquiries.

The MCP server underneath outlived the triage use. It became the team's standard agent integration path. I think that happened because once one server held the authentication, the monitoring and the audit log, the next agent did not need to rebuild any of it.

## Make the go/no-go a function

If the cost of a wrong answer is high, make the go/no-go a unit-testable function, not a sentence. A confidence score is not that function, however carefully you prompt for it. Let the model gather and explain. Let tested code decide.

Pick the one decision in your agent pipeline that closes something without a person looking. If you cannot write the RSpec example that goes red when that decision is wrong, the model should not be making it alone.

## Sources

- Model Context Protocol, Tools (2025-06-18): tool definition fields, error handling, human in the loop, security considerations: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- Model Context Protocol, Schema reference (2025-06-18), `ToolAnnotations` and its defaults: https://modelcontextprotocol.io/specification/2025-06-18/schema
- Claude Agent SDK, Configure permissions (evaluation order, deny rules, permission modes): https://code.claude.com/docs/en/agent-sdk/permissions
- Claude Agent SDK, Hooks (`PreToolUse`, `permissionDecision`): https://code.claude.com/docs/en/agent-sdk/hooks
- OpenAI, GPT-4 Technical Report, calibration and Figure 8: https://cdn.openai.com/papers/gpt-4.pdf
- Rails API 8.1.3, `ActiveRecord::ConnectionHandling#while_preventing_writes`: https://api.rubyonrails.org/v8.1.3/classes/ActiveRecord/ConnectionHandling.html
- Rails API 8.1.3, `ActiveRecord::Rollback`: https://api.rubyonrails.org/v8.1.3/classes/ActiveRecord/Rollback.html
- MySQL 8.0 Reference Manual, Statements That Cause an Implicit Commit: https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html
- Langfuse, Datasets: https://langfuse.com/docs/evaluation/dataset-runs/datasets
