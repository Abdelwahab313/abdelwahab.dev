---
title: "Scaling ECS workers on queue depth without killing long jobs"
kind: note
status: published
date: 2026-09-02
order: 1
lede: ECS scale-in was killing translation jobs up to two hours into their run. Scaling on queue depth and letting busy tasks finish before they stop fixed it.
tags: [aws, ecs, terraform]
featured: true
cover: /img/blog/fargate.svg
coverAlt: Line drawing of queued jobs draining into a container before shutdown.
---

## Work that disappeared

A translation could run anywhere from 30 seconds to 2 hours. When the worker fleet scaled in, ECS stopped tasks without asking which ones were busy. If a task was mid-job, that work was gone.

Nothing failed loudly. A task that had done most of a long translation just stopped being there, and getting the result meant starting the whole thing over. On a fleet that grows and shrinks all day, that is a tax on every quiet hour that follows a busy one.

## CPU said the fleet was idle while it was busy

It was an LLM translation product, and I had moved it off a single EC2 host onto ECS Fargate. Its load swung between a baseline of about 5K jobs an hour and peaks of 500K. A fleet with that swing scales in constantly, so whatever decides when to scale in also decides how often work gets thrown away.

That decision belonged to the default autoscaler, and it watched CPU and memory. For a web tier that is a fair proxy for load. A translation worker sends text to a model provider (Bedrock, OpenAI, Gemini) and waits, and a worker blocked on a slow provider call looks idle to CPU in the middle of a job. Ten of them look like spare capacity, so the autoscaler lowers the desired count, and ECS has no way to know which of the tasks it stops is holding a half-done translation.

## A longer stopTimeout cannot save a two-hour job

When ECS stops a task, each container gets a stop signal, `SIGTERM` unless the image sets a different `STOPSIGNAL`, and anything still running when the timeout ends gets `SIGKILL`. The timeout is the container's `stopTimeout`, which on Fargate defaults to 30 seconds and tops out at 120. A worker that catches `SIGTERM` can stop pulling work and finish anything short. It cannot finish the last 90 minutes of a two-hour job.

The job then fails quietly. An SQS message nobody deletes becomes visible again when its visibility timeout runs out, and another worker starts it from zero, every minute of the first attempt paid for and discarded. If the job had side effects, they run twice. If the retries reach `maxReceiveCount`, the message lands in the dead-letter queue, a failure the platform caused and someone else has to explain.

The other fixes did not fit. Never scaling in means paying all day for a fleet sized for 500K jobs an hour that sits almost idle at 5K. Making every job resumable meant a rewrite of how translation state is tracked, the kind of project that quietly becomes a quarter, and the team could not freeze feature work for it. A longer `stopTimeout` covers the 30-second jobs and nothing else. One task per job through `RunTask` removes scale-in, but a 30-second translation behind a Fargate cold start is mostly cold start, and I would expect the `RunTask` call rate to become the ceiling long before 500K jobs an hour. If the jobs were hours long and rare, I would use AWS Batch, which already works this way, and stop there.

In production I replaced the default autoscaler with a queue-depth autoscaler on Lambda, because queue depth measures the work waiting. On scale-in it told workers to drain: stop taking new jobs, finish the current one, exit, and only then get stopped. Its deployment state lived in DynamoDB, and that setup carried the fleet through peaks of 500K jobs an hour without killing jobs mid-run.

## Let the busy task say it is busy

The production code stays with the product, and the mechanism from here on comes from [ecs-drain-scaler](https://github.com/abdelwahab313/ecs-drain-scaler), a design-stage open-source rework I wrote later with each AWS behaviour traced to the docs. Writing it up showed me that on Fargate, "let it finish" has to mean ECS never chooses a busy task.

![Two timelines for the same two-hour job. Default scale-in sends SIGTERM, waits at most 120 seconds, then SIGKILLs the task and the rest of the job is lost. With scale-in protection the task is skipped, the job finishes, the task unprotects and only then stops.](diagram:fargate-stop-vs-drain)

ECS has a feature for exactly this: task scale-in protection. A protected task is not terminated by "scale-in events from either service auto scaling or deployments," and the first example on the AWS page is a queue processor where some tasks run for hours while overall utilisation is low. A task protects itself through the ECS container agent at the `ECS_AGENT_URI` it injects, which AWS recommends for queue workers because the agent has its own retries:

```sh
curl --request PUT --header 'Content-Type: application/json' \
  "${ECS_AGENT_URI}/task-protection/v1/state" \
  --data '{"ProtectionEnabled":true,"ExpiresInMinutes":135}'
```

It needs agent 1.65.0 or later, and the task role needs `ecs:GetTaskProtection` and `ecs:UpdateTaskProtection` even though the container only talks to the agent. Protection lasts 1 to 2,880 minutes and defaults to 120 if you leave the expiry out, and a full two-hour job outlives that. Derive it from the job's timeout plus a margin, and if you deploy with CloudFormation, keep it under the stack update's 3-hour timeout.

Calling the endpoint again resets the expiry, so it is tempting to protect at boot and renew forever. A protected idle task cannot be scaled in and holds up every deployment. The rule: protect after receiving a message and before starting it, unprotect the moment it ends, success or failure. An idle task is always stoppable.

The worker loop, trimmed from the rework's Ruby sketch:

```ruby
Signal.trap("TERM") { $stopping = true }   # stop taking work, nothing more

until $stopping
  msg = sqs.receive_message(queue_url: QUEUE, wait_time_seconds: 20).messages.first
  next unless msg

  unless protection(true, minutes: PROTECT) && !$stopping
    protection(false)   # refused or told to stop: hand the message back
    sqs.change_message_visibility(queue_url: QUEUE, receipt_handle: msg.receipt_handle,
                                  visibility_timeout: 0)
    next
  end

  heartbeat = keep_invisible(msg)   # thread extending visibility every minute
  begin
    translate(JSON.parse(msg.body), deadline: Time.now + JOB_MAX)
    sqs.delete_message(queue_url: QUEUE, receipt_handle: msg.receipt_handle)
  ensure
    heartbeat.kill
    protection(false)
  end
end
```

The order is the design. Receive, protect, check the stop flag again (ECS may have decided to stop this task while the protect call was in flight), and only then work, so a job never runs unprotected. `protection` wraps the agent call above, and the heartbeat stops the message reappearing to another worker mid-job. `translate` has to honour its deadline: a job killed at its deadline is a visible failure, and one still running after its protection lapsed is a silent one.

## Deployments wait for the longest job

On a rolling update ECS starts new tasks but does not stop old ones until their protection clears or expires. With `deployment_maximum_percent = 200`, a full new revision can run next to the old fleet for as long as the longest old job runs, up to double the task count. "Deployed" has to split in two. The new revision taking work should take minutes, and the deployment completing waits for the longest job that was running when it started. Any design that refuses to kill jobs has that bound, and once you name it, it stops looking like a bug.

Under steady load, an old-revision task that unprotects and takes the next message can hold the rollout open indefinitely, so before each poll the worker checks whether its task definition is still the service's `PRIMARY` deployment and exits once idle when it is not.

## The scaler should not be able to kill anything

Once workers protect themselves, the scaler only sets the desired count. The policy, from the rework's ADR, with `target` as messages per task:

```text
work      = visible + in_flight            # ApproximateNumberOfMessages + ApproximateNumberOfMessagesNotVisible
protected = tasks with protectionEnabled   # ListTasks, then GetTaskProtection
out       = ceil(work / target)
in        = ceil(work / (target * (1 - deadband)))

scale out when out > current:  new = max(out, protected), capped per step
scale in  when in  < current:  new = max(in, protected), held during a deployment,
                               on a longer cooldown than scale-out
```

![The control loop. The Lambda scaler reads visible and in-flight messages from SQS and the protected-task count from ECS, then sets the service's desired count to max(ceil(work / target), protected). Workers protect themselves while holding a job and unprotect before polling again.](diagram:fargate-scaler-loop)

Counting in-flight messages matters more than it looks. On a queue where every message is already being worked, the visible count is zero, and a scaler that reads only visible messages lowers the desired count under a fleet that is completely busy. ECS will not stop those protected tasks, but the desired count now sits below the protected count, and the next worker to receive a message gets `DEPLOYMENT_BLOCKED` when it tries to protect itself. The floor at the protected count, read exactly from ECS, prevents that.

The closest native option is target tracking with metric math, and AWS documents this signal as `ApproximateNumberOfMessagesVisible` divided by `RunningTaskCount`, with scale-in already paused during an ECS deployment. The documented expression reads only visible messages and the policy cannot floor at the protected count, but for a fleet of short jobs I would use it and write no scaler at all.

I owned that platform and its Terraform for a year and a half, and ran the worker fleet 90% on Spot. A Fargate Spot interruption is neither scale-in nor a deployment, so protection does not cover it. It comes with a two-minute warning, as `SIGTERM` and an EventBridge event, and for those stops the queue's retry is the only net.

The trade is paying for a task until its job finishes, against throwing away up to two hours of work. The scaler is also software you own, so in the rework any error means no change to the desired count, and an alarm fires when the scaler has not run for ten minutes, because a disabled schedule fails silently.

Spot aside, the design guarantees that the scaler is never the thing that kills a job. My rule now is that the thing which scales a worker fleet should only move a number. The only thing that knows a task is busy is the worker holding the message, so the worker says so, and the scaler's IAM policy carries no `ecs:StopTask` and no `ecs:UpdateTaskProtection`. That policy is the proof, not a comment promising it.

## Sources

- Amazon ECS, task scale-in protection: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-scale-in-protection.html
- Amazon ECS, task scale-in protection endpoint: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-scale-in-protection-endpoint.html
- Amazon ECS API, `StopTask`: https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_StopTask.html
- Amazon ECS, task definition parameters (`stopTimeout`): https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html
- Amazon ECS, Fargate Spot termination notices: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html
- Amazon SQS, visibility timeout: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html
- Application Auto Scaling, target tracking with metric math: https://docs.aws.amazon.com/autoscaling/application/userguide/application-auto-scaling-target-tracking-metric-math.html
- ecs-drain-scaler, README and ADRs 0001 to 0005: https://github.com/abdelwahab313/ecs-drain-scaler
