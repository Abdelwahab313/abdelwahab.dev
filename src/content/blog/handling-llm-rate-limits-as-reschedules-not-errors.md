---
title: "Handling LLM rate limits as reschedules, not errors"
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

Work in the review step of our translation pipeline kept failing, and each time the user saw an error. When we looked at why, rate limit errors were behind 65% of those failures.

That number changed what the problem was. Most of our review failures were not bugs in our code or bad model output. They were a provider telling us to slow down, and our code hearing "this work is broken."

The product was a metered LLM translation service. Customers paid in credits, so cost and correctness mattered on every call. From where the user sat, our product was broken, and the provider that caused it was invisible to them.

The fix was to read a 429 as a signal to reschedule the work.

## A 429 is not one thing

We called three providers: Claude on Bedrock, OpenAI and Gemini. They all use HTTP 429 for "too many requests," and that shared status code hides three different vocabularies. Some 429s clear in seconds. Some do not clear until a daily quota resets or someone adds credit.

| Provider | Throttling signal | Looks similar, means something else |
|---|---|---|
| Bedrock | `ThrottlingException`, 429: the request exceeded the account's quota | `ServiceUnavailableException`, 503: high demand on the service, explicitly not your quota. `ModelNotReadyException` is also a 429. |
| OpenAI | 429 "Rate limit reached for requests", with a `Retry-After` header when present | A 429 for billing (`error.type` of `insufficient_quota`) that no retry will fix until credits or limits change |
| Gemini | 429 `rate_limit_exceeded`: the per-minute or per-second request or token limit | 429 `quota_exceeded`: the daily quota, gone until it resets or the quota is raised |

RFC 6585 defines 429 as "too many requests in a given amount of time," says the response may carry a `Retry-After` header, and on purpose does not define how the server counts requests. So every provider counts differently, and the only portable facts are the status code and, sometimes, the header.

That is why scattering `if status == 429 then retry` across the codebase was the wrong shape before it was the wrong logic. Every caller had to know which 429 it was holding, and every provider quirk leaked into every caller.

## Retry in one layer, and make it the queue

The obvious answer to a throttled call is to retry it. It was also the wrong one. Retrying a throttled call does not make the provider less busy. It makes you noisier.

OpenAI's rate-limit guide says unsuccessful requests count toward your per-minute limit, so continuously resending a request won't work. A tight retry loop against a rate limit burns the very budget it is waiting for.

The amplification gets worse with layers. Marc Brooker's Builders' Library article works through a five-deep call stack where each layer retries three times, and the load on the bottom service increases 243 times. His advice is to retry at a single point in the stack.

The layers are easy to stack by accident. The AWS SDKs already retry throttling errors on their own, with full jitter and a retry quota, and the attempt count depends on the SDK and its version. A job that wraps a Bedrock call in its own retry loop, inside a worker that also retries failed jobs, is three layers deep before anyone wrote the word "retry" on purpose.

My rule: retry in exactly one layer, and for throttling that layer is the queue, not the HTTP client.

## One engine sorts every provider error

The hard constraint was that a provider outage could not become our outage.

We built the engine as a team, a single layer in front of all three providers, in Rails. The aim was that a caller never had to know which provider answered, or how it failed.

The first job of that layer is translation, in the other sense: each provider adapter maps its own errors into a vocabulary the rest of the system understands. The code here is a sketch.

```ruby
module Engine
  class RateLimited < StandardError
    attr_reader :retry_after

    def initialize(retry_after: nil)
      @retry_after = retry_after
      super("provider rate limited")
    end
  end
end
```

The other error classes are one-liners: `Unavailable` (5xx, overload, model timeouts), `QuotaExhausted` (will not clear on its own), `BadRequest` (our fault, never retried) and `Reschedule`, which carries a `retry_after` and means every provider in the fallback chain refused.

The OpenAI adapter has to look inside the body, because the same 429 status carries both a rate limit and a billing failure:

```ruby
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

Bedrock's `ModelNotReadyException` is also a 429, but closer to "not up yet" than "slow down," and the Converse API reference notes the SDK already retries it up to 5 times. So the Bedrock adapter files it under `Unavailable`.

An answer could still be unusable. The engine stripped code fences around a complete JSON object and refused to close a truncated one, because on a metered product the customer should not pay for a guess. Metering had its own failure. Credits were charged per LLM request, and I found a race between checking the balance and charging it, a few milliseconds wide, that had been silently pausing work. The fix shape is the one from [the Redis post](/blog/preventing-stock-overselling-in-redis-with-lua-scripts): put the check inside the `UPDATE`.

## A fallback chain where a 429 does not trip the breaker

Ordered fallback chains meant a throttled primary did not stop the request. Each call had a list of providers, primary first. A rate limit or an outage on one moved the call to the next.

```ruby
module Engine
  class Chain
    def initialize(providers, breakers:)
      @providers = providers
      @breakers  = breakers # one breaker per provider
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

`BadRequest` is not rescued on purpose: a malformed request is a bug in our code, and the chain would only collect more rejections.

The detail I would defend in a review is that a 429 does not count against the breaker. A rate limit means the provider is healthy and asking you to wait. A 503 or a timeout means it might not be healthy at all. Counting both the same way opens the breaker on a provider that would have answered in a few seconds.

A per-process breaker that goes half-open after a cool-off is good enough to stop hammering a provider that is down, and not good enough to decide whether to page someone.

![A request walks the ordered chain. Bedrock answers 429 with a Retry-After, so the call moves on and the breaker stays closed. OpenAI's breaker is open, so it is skipped without a call. Gemini answers. Had every provider refused, the job would be rescheduled with the smallest Retry-After.](diagram:engine-fallback-chain)

## Rescheduling with Retry-After as the floor

When every provider in the chain refused, the job went back on the queue with a delay. This works because translation already ran as queued jobs on a worker fleet (the one in [the Fargate post](/blog/scaling-ecs-workers-on-queue-depth-without-killing-long-jobs)), anywhere from 30 seconds to 2 hours long. Nobody was holding an HTTP connection open waiting for an answer, so "later" was an acceptable answer.

The delay has two parts. `Retry-After` is a floor: the provider has said when it expects capacity, and waking up earlier wastes a call against the limit. Jitter goes on top. Without it, every job that got the same header in the same second wakes up in the same second and throttles again. Marc Brooker's 2015 simulations found un-jittered exponential backoff "the clear loser," and that full jitter "uses less work, but slightly more time."

```ruby
module Engine
  module Backoff
    BASE = 1.0   # seconds
    CAP  = 300.0 # placeholder

    def self.delay(attempt, retry_after)
      jitter = rand * [CAP, BASE * 2**attempt].min
      retry_after.to_f + jitter
    end
  end
end

class ReviewJob < ApplicationJob
  MAX_RESCHEDULES = 8 # placeholder

  def perform(batch_id)
    Engine.review(batch_id)
  rescue Engine::Reschedule => e
    raise if executions >= MAX_RESCHEDULES
    retry_job(wait: Engine::Backoff.delay(executions, e.retry_after))
  end
end
```

Rails' own `retry_on` would do much of this, but its wait proc gets the execution count, not the error, so it cannot read `Retry-After`, the most accurate number in the calculation.

The reschedule limit matters more than it looks. A daily quota that is gone will refuse every reschedule until it resets. Without a limit, a reschedule loop is a retry storm that happens to be slow.

## What the single engine cost

Customer-visible failures dropped and alerts got quieter. I think most of the quiet is because a rate limit that becomes a reschedule is not an incident.

Fallback has a cost the error rate does not show. A translation that falls through to the second provider comes from a different model. I think "a different but valid translation now" beats "no translation," but that is a product decision, and it needs a trace to defend it. Langfuse tracing named which provider actually answered each request.

Rescheduling trades failures for latency. For background jobs measured in seconds to hours, that is a good trade. For a user waiting on a synchronous request, a reschedule is just a slower error, and the right move is to fail fast with a clear message or hold a reserve of capacity.

The engine is only worth building when there is more than one provider or more than one caller. With one provider and one call site, the SDK's own retries and a single `rescue` are honest and cheaper.

Before you write the retry, sort every error your providers can return into "wait," "go elsewhere," "stop," and "our bug." Then make sure exactly one layer of the system acts on "wait."

## Sources

- Amazon Bedrock docs, Converse API reference and troubleshooting API error codes: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html, https://docs.aws.amazon.com/bedrock/latest/userguide/troubleshooting-api-error-codes.html
- AWS SDKs and Tools reference, retry behavior: https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html
- OpenAI API docs, rate limits and error codes: https://developers.openai.com/api/docs/guides/rate-limits, https://developers.openai.com/api/docs/guides/error-codes
- Gemini API docs, API errors: https://ai.google.dev/gemini-api/docs/api-errors
- RFC 6585 section 4, 429 Too Many Requests: https://www.rfc-editor.org/rfc/rfc6585.html
- Marc Brooker, Exponential Backoff and Jitter, AWS Architecture Blog, 2015: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
- Marc Brooker, Timeouts, retries, and backoff with jitter, Amazon Builders' Library: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
