---
title: Rate limits caused most of our LLM review failures
kind: note
status: published
date: 2026-09-05
order: 2
lede: 'Rate limits caused 65% of our LLM review failures. Treating them as reschedules, not errors, kept provider throttling from becoming our outage.'
tags: [llm, rails, aws]
cover: /img/blog/engine.svg
coverAlt: An engine box with three provider paths, the dashed Bedrock path returning 429, the solid path routed to OpenAI, and Gemini waiting in the chain.
---

## 65% of review failures were the provider saying "not now"

Work in the review step kept failing, and each time the user saw an error. When we looked at why, rate limit errors were behind 65% of those failures.


That number changed what the problem was. Most of our review failures were not bugs in our code or bad model output. They were a provider telling us to slow down, and our code hearing "this work is broken."

The product was a metered LLM translation service. Customers paid in credits, so ordering, cost and correctness all mattered on every call. Every time a provider throttled, the work just failed. From where the user sat, our product was broken, and the provider that caused it was invisible to them.

## A 429 is not one thing

The engine called three providers: Claude on Bedrock, OpenAI and Gemini. They all use HTTP 429 for "too many requests," and that shared status code hides three different vocabularies. Some 429s clear in seconds. Some do not clear until a daily quota resets or someone adds credit.

| Provider | Throttling signal | Looks similar, means something else |
|---|---|---|
| Bedrock | `ThrottlingException`, 429: the request exceeded the account's quota | `ServiceUnavailableException`, 503: high demand on the service, explicitly not your quota. `ModelNotReadyException` is also a 429. |
| OpenAI | 429 "Rate limit reached for requests", with a `Retry-After` header when present | A 429 for billing (`error.type` of `insufficient_quota`) that no retry will fix until credits or limits change |
| Gemini | 429 `rate_limit_exceeded`: the per-minute or per-second request or token limit | 429 `quota_exceeded`: the daily quota, gone until it resets or the quota is raised |

OpenAI also sends the state of your budget on responses: `x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens` and the matching `x-ratelimit-reset-*` headers say how much room is left and when it comes back. Its docs define `Retry-After` as the minimum number of seconds to wait before retrying a temporary rate-limit error, and say plainly that it does not mean a quota or billing error can be fixed by retrying.

Behind all of them sits the same contract. RFC 6585 defines 429 as "too many requests in a given amount of time" and says the response may carry a `Retry-After` header. RFC 9110 allows that header to be either a number of seconds or an HTTP date. RFC 6585 also says, on purpose, that it does not define how the server identifies the user or counts requests. So every provider counts differently, and the only portable facts are the status code and, sometimes, the header.

That is why scattering `if status == 429 then retry` across the codebase was the wrong shape before it was the wrong logic. Every caller had to know which 429 it was holding. Every provider quirk leaked into every caller, and the quirks were different per provider.

## Retrying harder makes the provider busier

The obvious answer to a throttled call is to retry it. It was also the wrong one. Retrying a throttled call does not make the provider less busy. It makes you noisier.

OpenAI's rate-limit guide says it directly: unsuccessful requests count toward your per-minute limit, so continuously resending a request won't work. A tight retry loop against a rate limit burns the very budget it is waiting for.

The amplification gets worse with layers. Marc Brooker's Builders' Library article on timeouts and retries works through a five-deep call stack where each layer retries three times: if each layer retries independently, the load on the bottom service increases 243 times. His advice is to retry at a single point in the stack. He also calls retries "selfish," because each one spends the server's capacity to improve one client's odds.

The layers are easy to stack by accident. The AWS SDKs already retry throttling errors on their own: the SDK retry reference describes exponential backoff with full jitter, a longer base delay for throttling than for transient errors, and a token bucket retry quota that stops retrying when failures are widespread. The mode and the attempt count depend on the SDK and its version, so read what your client already does before you wrap a loop around it. A job that wraps a Bedrock call in its own retry loop, inside a worker that also retries failed jobs, is three layers deep before anyone wrote the word "retry" on purpose.

My rule: retry in exactly one layer, and for throttling that layer is the queue, not the HTTP client.

## One engine owns provider behavior

The hard constraint was that the product had to stay up while a provider degraded. A provider outage could not become our outage.

We built the engine as a team, a single layer in front of all three providers, in Rails. The aim was that a caller never had to know which provider answered, or how it failed.

The first job of that layer is translation, in the other sense. Each provider adapter maps its own errors into a vocabulary the rest of the system understands. What follows is a sketch of the approach, not the production code:

```ruby
module Engine
  class RateLimited < StandardError
    attr_reader :retry_after

    def initialize(retry_after: nil)
      @retry_after = retry_after
      super("provider rate limited")
    end
  end

  class Unavailable    < StandardError; end # 5xx, overload, model timeouts
  class QuotaExhausted < StandardError; end # will not clear on its own
  class BadRequest     < StandardError; end # our fault, never retry

  # Every provider in the chain refused. The job should run again later.
  class Reschedule < StandardError
    attr_reader :retry_after

    def initialize(retry_after: nil)
      @retry_after = retry_after
      super("all providers refused, reschedule")
    end
  end
end
```

The Bedrock adapter can rescue the SDK's generated error classes, which all extend `Aws::BedrockRuntime::Errors::ServiceError`. The OpenAI adapter has to look inside the body, because the same 429 status carries both a rate limit and a billing failure:

```ruby
# Bedrock, through aws-sdk-bedrockruntime
def converse(params)
  @client.converse(params)
rescue Aws::BedrockRuntime::Errors::ThrottlingException
  raise Engine::RateLimited
rescue Aws::BedrockRuntime::Errors::ServiceUnavailableException,
       Aws::BedrockRuntime::Errors::ModelTimeoutException,
       Aws::BedrockRuntime::Errors::ModelNotReadyException
  raise Engine::Unavailable
rescue Aws::BedrockRuntime::Errors::ValidationException
  raise Engine::BadRequest
end

# OpenAI, from a raw HTTP response
def classify(status, headers, body)
  case status
  when 429
    raise Engine::QuotaExhausted if body.dig("error", "type") == "insufficient_quota"
    raise Engine::RateLimited.new(retry_after: headers["retry-after"]&.to_f)
  when 500..599 then raise Engine::Unavailable
  when 400..499 then raise Engine::BadRequest
  end
end
```

Bedrock's `ModelNotReadyException` is a 429 that means something closer to "not up yet" than "slow down," and the Converse API reference notes the SDK already retries it up to 5 times. The sketch files it with the unavailable errors for that reason. If the SDK has given up on it, I would not want the engine to treat it as a polite throttle.

## Fallback chains instead of one provider

Ordered fallback chains meant a throttled primary did not stop the request. Each call had a list of providers, primary first. A rate limit or an outage on one moved the call to the next.

```ruby
module Engine
  class Chain
    def initialize(providers, breakers:)
      @providers = providers # ordered, primary first
      @breakers  = breakers  # one circuit breaker per provider
    end

    def complete(request)
      waits = []

      @providers.each do |provider|
        breaker = @breakers.fetch(provider.name)
        next unless breaker.allow?

        begin
          result = provider.complete(request)
          breaker.success!
          return result
        rescue RateLimited => e
          waits << e.retry_after # healthy but busy: no breaker failure
        rescue Unavailable, QuotaExhausted
          breaker.failure!
        end
      end

      raise Reschedule.new(retry_after: waits.compact.min)
    end
  end
end
```

`BadRequest` is not rescued on purpose. A request that one provider rejects as malformed is a bug in our code, and sending it down the chain only collects more rejections.

The detail I would defend in a review is that a 429 does not count against the breaker. A rate limit means the provider is healthy and asking you to wait. A 503 or a timeout means it might not be healthy at all. Counting both the same way opens the breaker on a provider that would have answered in a few seconds.

![A request walks the ordered chain. Bedrock answers 429 with a Retry-After, so the call moves on and the breaker stays closed. OpenAI's breaker is open, so it is skipped without a call. Gemini answers. Had every provider refused, the job would be rescheduled with the smallest Retry-After.](diagram:engine-fallback-chain)

## A rate limit is a reschedule, not an exception

When every provider in the chain refused, the request did not fail. Rate limits stopped being exceptions and became reschedule signals. The job went back on the queue with a delay, honoring retry-after where the provider sent one, with jitter to avoid synchronized retries.

This works because translation already ran as queued jobs on a worker fleet (the one in [the Fargate post](/blog/fargate)), anywhere from 30 seconds to 2 hours long. Nobody was holding an HTTP connection open waiting for an answer, so "later" was an acceptable answer.

The delay needs two parts. `Retry-After` is a floor: the provider has said when it expects capacity, and waking up earlier wastes a call against the limit. Jitter goes on top of it. Without jitter, every job that got the same header in the same second wakes up in the same second and throttles again. The AWS Architecture Blog post on backoff and jitter showed this with simulations in 2015: un-jittered exponential backoff was "the clear loser," and full jitter, a uniformly random delay between zero and the capped exponential value, "uses less work, but slightly more time."

A sketch in ActiveJob terms:

```ruby
module Engine
  module Backoff
    BASE = 1.0    # seconds
    CAP  = 300.0  # placeholder; pick it from your job's tolerance

    # Full jitter on top of the provider's own floor.
    def self.delay(attempt, retry_after)
      jitter = rand * [CAP, BASE * 2**attempt].min
      retry_after.to_f + jitter
    end
  end
end

class ReviewJob < ApplicationJob
  MAX_RESCHEDULES = 8 # placeholder; a cap so a dead quota cannot loop forever

  def perform(batch_id)
    Engine.review(batch_id)
  rescue Engine::Reschedule => e
    raise if executions >= MAX_RESCHEDULES
    retry_job(wait: Engine::Backoff.delay(executions, e.retry_after))
  end
end
```

`executions` is ActiveJob's count of how many times this job has run, incremented on every retry, so it doubles as the attempt number. `retry_job(wait:)` re-enqueues the same job with a delay. Rails' own `retry_on` would do much of this, and its `:polynomially_longer` wait includes a 15% jitter by default. The sketch spells it out because `retry_on`'s wait proc is handed the execution count, not the error, so it cannot read `Retry-After`, and the provider's floor is the most accurate number in the whole calculation.

The cap matters more than it looks. A daily quota that is gone will refuse every reschedule until it resets. Without a limit, a reschedule loop is a retry storm that happens to be slow.

## A circuit breaker for the provider that keeps failing

A circuit breaker cut off a provider that kept failing instead of hammering it. The pattern is Martin Fowler's description from 2014: a closed breaker passes calls through and counts failures; past a threshold it trips open and every call returns an error without the protected call being made; after an interval it goes half-open and lets a trial call through, which either resets the breaker or restarts the timeout.

In a fallback chain, "returns an error" becomes "skip to the next provider." That is the point of putting the two together. An open breaker on the primary turns every request into a call on the secondary, with no wasted round trip to a provider that is down.

```ruby
class Breaker
  def initialize(threshold: 5, cool_off: 30) # placeholders
    @threshold = threshold
    @cool_off  = cool_off
    @failures  = 0
    @opened_at = nil
  end

  def allow?
    return true if @opened_at.nil?          # closed
    Time.now - @opened_at >= @cool_off      # half-open after the cool-off
  end

  def success!
    @failures  = 0
    @opened_at = nil                        # back to closed
  end

  def failure!
    @failures += 1
    # Trip on the threshold, or re-open if a half-open trial failed.
    @opened_at = Time.now if @failures >= @threshold || @opened_at
  end
end
```

This version is per process and not thread safe, and once half-open it lets every caller through as a trial, not just one. Across a fleet of workers, each one learns separately that a provider is down. I think that is acceptable for a breaker whose job is to stop hammering, because a few extra failed calls per worker is cheap. It is not acceptable if the breaker is also how you decide to page someone.

## Valid JSON is not the JSON you asked for

JSON repair handled malformed responses, so a mangled object did not become a lost translation.

Structured output features have narrowed this problem. They have not closed it. OpenAI's structured outputs guide draws the line itself: JSON mode and Structured Outputs both ensure valid JSON, but only Structured Outputs ensure schema adherence. The same guide lists the cases where even schema-constrained output is not what you asked for. A refusal does not necessarily follow the schema. A response that hits the max-tokens limit is incomplete JSON. A generation halted by the content filter may be partial. In JSON mode without an explicit instruction to produce JSON, the model may generate an unending stream of whitespace.

Bedrock's Converse API reports the same family of outcomes in `stopReason`. Its valid values include `max_tokens`, `content_filtered`, `malformed_model_output` and `malformed_tool_use`.

So the repair step has two jobs, and they pull in opposite directions. It should fix what is mechanically wrong around a complete answer. It should refuse to "fix" an answer that is not complete. A sketch of where I draw that line:

```ruby
require "json"

module Engine
  class Truncated   < StandardError; end
  class Unparseable < StandardError; end

  # stop_reason as Bedrock Converse reports it.
  def self.parse_model_json(text, stop_reason:)
    raise Truncated if stop_reason == "max_tokens" # incomplete, do not guess

    body = text.strip
               .sub(/\A```(?:json)?\s*/, "") # leading code fence
               .sub(/\s*```\z/, "")          # trailing code fence

    first = body.index("{")
    last  = body.rindex("}")
    raise Unparseable if first.nil? || last.nil?

    JSON.parse(body[first..last])
  rescue JSON::ParserError
    raise Unparseable
  end
end
```

Stripping a code fence or prose around a complete object is safe, because nothing is invented. Closing an unterminated array of translated segments is not repair. It is deciding, on the customer's behalf, that the missing segments did not exist. In the sketch a truncated answer raises instead of parsing, so the engine handles it as a failure. On a metered product, the customer should not pay for a guess.

After parsing, I would still check the parsed object against the request. If you sent forty segment ids, forty should come back. Valid JSON with thirty-nine keys passes every parser and still loses a translation.

## Tracing showed which provider actually answered

Langfuse tracing made the provider path visible instead of guessed at. A trace records each request as structured operations with timing, inputs and outputs, and for LLM calls it captures the prompt, the response, token usage and latency.

With a fallback chain, this matters more than with one provider. The same request can be served by the primary on Monday and the second provider on Tuesday, and the output differs. Without a trace, "why does this translation look different" has no answer. With one, it has a provider name and a reason the chain moved on.

## The few-millisecond race on the credit balance

The engine was metered, so credits and billing correctness sat on top of it. I owned that too. Credits worked as a prepaid balance, authorized and charged per LLM request.

I found a check-then-act race with a window of a few milliseconds that had been silently pausing work. I will not reproduce the production code here, but the class of bug has one textbook shape. Two jobs for the same account read the balance, both decide there is enough, and both act:

```
1. Job A  SELECT balance          -> 10
2. Job B  SELECT balance          -> 10    both see enough for a cost of 8
3. Job A  UPDATE balance = 2
4. Job B  UPDATE balance = 2               one charge is lost, or with
                                           balance = balance - 8 it goes to -6
```

Seven milliseconds sounds too small to matter. I think it stops being small the moment several workers run jobs for the same account at once, and a queue-driven fleet chewing through one customer's large batch does exactly that.

The MySQL manual explains why reading first cannot protect the write that follows. A plain `SELECT` in InnoDB is a consistent read from a snapshot. The manual's own warning about locking reads is that if you query data and then update related data in the same transaction, a regular `SELECT` does not give enough protection, because other transactions can change the rows you just read. An `UPDATE ... WHERE`, on the other hand, sets exclusive locks on the records it searches, and the snapshot rule applies to `SELECT` statements, not necessarily to DML.

That points at the fix shape: put the check inside the write, so there is no gap between them.

![Two jobs for the same account charge a cost of 8 against a balance of 10. On the left each reads the balance, both see enough, and both write, so one charge is lost. On the right the check is inside the UPDATE, so the first job charges and the second affects zero rows.](diagram:engine-credit-race)

```sql
UPDATE credit_accounts
SET    balance = balance - :cost
WHERE  id = :account_id
  AND  balance >= :cost;
-- 1 row affected: charged. 0 rows affected: not enough credit.
```

In Rails, `update_all` issues that statement and returns the number of rows affected. It also skips callbacks and validations, which here is the point rather than a cost:

```ruby
charged = CreditAccount
  .where(id: account_id)
  .where("balance >= ?", cost)
  .update_all(["balance = balance - ?", cost])

raise InsufficientCredit if charged.zero?
```

`SELECT ... FOR UPDATE` (`lock!` or `with_lock` in Rails) also closes the gap, by locking the row before the check. I would reach for the conditional update first. It is one statement and one round trip, it needs no explicit transaction around it, and it cannot be broken by someone later adding a slow call between the check and the charge. This is the same read, decide, write gap as [atomic Redis commands that still oversell stock](/blog/redis-lua-race-conditions), in a different store.

The race was a symptom of a wider shape. Credit checks were scattered across the code, and every place that checked credit was a place that could check and act in its own way. Later I replaced the scattered credit checks with one authorization path, written up across four ADRs, and the first step of it merged. One path means one place where the check and the charge are a single operation, and one place to read when someone asks why a job paused.

## What the single engine cost

The cost was real. A single abstraction meant giving up some vendor-specific behavior. Whatever one provider did better than the others had to either fit the engine's shape or go unused. We took that trade, and my argument for it was simple: being able to reason about one request path was worth more than any one provider's niceties.

Fallback has a cost the error rate does not show. A translation that falls through to the second provider comes from a different model. For a translation product, I think "a different but valid translation now" beats "no translation," but that is a product decision, and it needs the trace to be defensible when a customer asks.

Rescheduling trades failures for latency. A throttled job finishes later instead of failing now. For background jobs measured in seconds to hours, that is a good trade. For a user waiting on a synchronous request, a reschedule is just a slower error. There the right move is to fail fast with a clear message, or to hold a reserve of capacity, not to queue.

And the engine is only worth building when there is more than one provider or more than one caller. With one provider and one call site, the SDK's own retries and a single `rescue` are honest and cheaper.

## A provider outage stopped being our outage

A provider outage stopped being our outage. Customer-visible failures dropped, and alerts got quieter, without over-provisioning to sit under every provider's ceiling.

I think that is most of why the alerts went quiet. A rate limit that becomes a reschedule is not an incident. It is the system doing what it was designed to do, and nobody needs to be woken up for it.

## Decide what a 429 means before the provider sends one

Model provider limits in your own control flow, with backoff and rescheduling, not as a generic exception. Before you write the retry, sort every error your providers can return into "wait," "go elsewhere," "stop," and "our bug." Then make sure exactly one layer of the system acts on "wait."

If a dependency will be unreliable, decide how your system behaves before it is.

## Sources

- Amazon Bedrock API reference, Converse (errors, `stopReason` values): https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
- Amazon Bedrock User Guide, troubleshooting API error codes (`ThrottlingException` versus `ServiceUnavailable`): https://docs.aws.amazon.com/bedrock/latest/userguide/troubleshooting-api-error-codes.html
- AWS SDK for Ruby, `Aws::BedrockRuntime::Errors`: https://docs.aws.amazon.com/sdk-for-ruby/v3/api/Aws/BedrockRuntime/Errors.html
- AWS SDKs and Tools reference, retry behavior (full jitter, throttling base delay, retry quota): https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html
- OpenAI API docs, rate limits (`x-ratelimit-*` headers, `Retry-After`, failed requests count): https://developers.openai.com/api/docs/guides/rate-limits
- OpenAI API docs, error codes (`insufficient_quota`): https://developers.openai.com/api/docs/guides/error-codes
- OpenAI API docs, structured outputs (JSON mode versus schema adherence, refusals, incomplete output): https://developers.openai.com/api/docs/guides/structured-outputs
- Gemini API docs, API errors (`rate_limit_exceeded` versus `quota_exceeded`): https://ai.google.dev/gemini-api/docs/api-errors
- RFC 6585 section 4, 429 Too Many Requests: https://www.rfc-editor.org/rfc/rfc6585.html
- RFC 9110 section 10.2.3, Retry-After: https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after
- Marc Brooker, Exponential Backoff and Jitter, AWS Architecture Blog, 2015: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
- Marc Brooker, Timeouts, retries, and backoff with jitter, Amazon Builders' Library: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
- Martin Fowler, CircuitBreaker, 2014: https://martinfowler.com/bliki/CircuitBreaker.html
- Rails API, `ActiveJob::Exceptions#retry_job`, `retry_on`, `ActiveJob::Core#executions`: https://api.rubyonrails.org/classes/ActiveJob/Exceptions.html
- Rails API, `ActiveRecord::Relation#update_all`: https://api.rubyonrails.org/classes/ActiveRecord/Relation.html#method-i-update_all
- MySQL 8.0 manual, consistent nonlocking reads, locking reads, and locks set by SQL statements in InnoDB: https://dev.mysql.com/doc/refman/8.0/en/innodb-consistent-read.html, https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html, https://dev.mysql.com/doc/refman/8.0/en/innodb-locks-set.html
- Langfuse docs, observability overview: https://langfuse.com/docs/observability/overview
