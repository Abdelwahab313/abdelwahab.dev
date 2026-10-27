# Blog idea backlog

Raw ideas for the pipeline in `docs/BLOG-WORKFLOW.md`. One line per idea:
the angle, not the topic. Append freely, including spin-offs the pipeline
produces. When an idea is drafted, mark it `[drafted: <slug>]`; when
published, `[shipped: <slug>]`.

Experience ideas are grounded in the CV facts carried by `CONTENT.md`
section 3 (Work experience). Learning ideas are topics worth researching and
writing to learn. Every experience idea respects the anonymity rule: the post
never names the product, employer, or client.

## Experience ideas (grounded in CV facts)

- **Advisory locks as a concurrency budget.** A hot path degraded under
  concurrent writes, and the fix was not "add locks" but choosing which paths
  truly needed exclusivity, then batching the rest. Angle: locks are a
  budget you spend, not a feature you add.
- **The permission check that grew in eleven places.** One authorization
  architecture replacing scattered permission checks in a metered LLM
  product. Angle: billing correctness is a security problem, and both fail
  the same way, through the gaps between checks.
- **What a triage agent may do on its own.** An agentic triage platform
  handling first-line incident and support inquiries: what was kept behind
  guardrails, what was let through, and what the verdict-drawing line was.
  Angle: the interesting question is not "can it triage" but "when is it
  allowed to decide".
- **A database CPU incident that was a query plan incident.** Clearing
  Aurora MySQL's worst-query backlog query by query: covering indexes,
  rewritten plans, restructured hot reads. Angle: CPU pressure is usually a
  symptom; the incident review that treats it as the disease goes nowhere.
- **JS to TS so the customer stops seeing it first.** Migrating a real-time
  order service from JavaScript to TypeScript so payload mismatches fail at
  compile time. Angle: types are an incident-prevention tool with a
  migration cost, and the payoff shows up in the failures you stop having.
- **Write-behind Redis in front of MySQL.** Hot order state served from
  Redis with MySQL behind it, keeping status fan-out off the transactional
  path. Angle: where the cache's honesty has to end, and what breaks first
  when it does.
- **Incremental extraction when a rewrite is not on the table.** Decomposing
  a fulfillment component out of a PHP monolith over SQS, chosen because a
  team of six could not freeze features for months. Angle: the constraint
  that picked the architecture.

## Learning ideas (research and write to learn)

- **MCP as an agent's hands, and what that costs.** What Model Context
  Protocol actually changes about how an agent touches live systems, and
  where the interesting failure modes are.
- **Fallback chains across LLM providers.** Designing a multi-provider
  engine (Bedrock, OpenAI, Gemini): what degrades, what retries, and what
  "provider-agnostic" quietly promises.
- **Evals for an LLM feature that ships.** What a minimal evaluation harness
  for a production LLM feature actually contains, and what it cannot catch.
- **Queue depth as an autoscaling signal.** Why CPU and memory misread
  batch workloads, and how a queue-depth scaler changes fleet behavior.
- **Terraform state as a product surface.** Owning a platform's Terraform
  for 16 months: what belongs in modules, what belongs in state, and the
  blast-radius decisions.

## Spin-offs from the pipeline

Cut from posts trimmed to the 1,800-word budget on 2026-10-27. The full
pre-trim text of every post is at commit `ec4dbcf`:
`git show ec4dbcf:src/content/blog/<slug>.md`.

- **Writing a Node.js Transform or Writable that keeps backpressure.**
  From `handling-backpressure-in-node-js-streams`: the `Lines` Transform and
  why ignoring `push()` is safe, a batching Writable with `_final`, child
  process stdin/stdout ordering, and `process.stdout` being async on pipes.
- **A check-then-act race on a credit balance.** From
  `handling-llm-rate-limits-as-reschedules-not-errors`: the race a few
  milliseconds wide that silently paused work, conditional `UPDATE` against
  `SELECT ... FOR UPDATE`, and the move to one authorization path (diagram
  `src/diagrams/engine-credit-race.svg` already exists).
- **Where LLM JSON repair should stop.** Same source: strip fences, refuse to
  close a truncated object, structured outputs without schema adherence.
- **Read-only credentials for agents.** From
  `making-llm-triage-verdicts-testable-in-code`: `readOnlyHint` is a hint,
  Rails `while_preventing_writes` is not a readonly user, MySQL DDL commits
  the open transaction, Agent SDK deny order.
- **Reading a query plan on a writer pinned at 100% CPU.** From
  `fixing-aurora-mysql-100-percent-cpu-by-removing-a-join`: `EXPLAIN FOR
  CONNECTION`, `EXPLAIN ANALYZE` on a reader, `FLUSH STATUS` handler counts,
  the digest table as a measurement window.
- **Storing availability as wall-clock time plus an IANA zone.** From
  `building-a-booking-marketplace-from-empty-repo-to-beta`: the DST example,
  Zoom moving a past `start_time` to now, `freeBusy` intervals (diagram
  `src/diagrams/launch-ci-gate.svg` is also unused now).
- **Background location check-ins from a driver app.** From
  `live-order-status-over-socket-io-and-redis`: volatile emits for positions,
  acked resends for check-ins, the team of five.
- **Following one EVAL through the Redis source.** From
  `preventing-stock-overselling-in-redis-with-lua-scripts`: script flags,
  replication of effects, EVAL vs Functions and script cache eviction.
- **SQS FIFO in practice.** From
  `extracting-fulfillment-from-a-php-monolith-over-sqs`: throughput per
  group, `maxReceiveCount` traps, the full receive loop with `failedGroups`.
- **Terraform and deploy races for protected ECS workers.** From
  `scaling-ecs-workers-on-queue-depth-without-killing-long-jobs`:
  `DEPLOYMENT_BLOCKED`, the 12-hour visibility ceiling, deadband and lagging
  SQS counts.
