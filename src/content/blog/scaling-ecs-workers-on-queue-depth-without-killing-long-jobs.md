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

Nothing failed loudly. A task that had done most of a long translation just stopped being there, and getting the result meant starting the whole thing over. On a fleet that grows and shrinks all day, that is not an edge case. It is a tax on every quiet hour that follows a busy one.

## CPU said the fleet was idle while it was busy

The product was an LLM translation product, and I had moved it off a single EC2 host onto ECS Fargate. Its load was anything but flat: a baseline of about 5K jobs an hour, and peaks of 500K. A fleet with that swing scales in constantly, so whatever decides when to scale in also decides how often work gets thrown away.

That decision belonged to the default autoscaler, and it watched CPU and memory. ECS publishes a service's average CPU and memory to CloudWatch, and target tracking on either is the easy path the docs lead you down. For a web tier that is a fair proxy for load. For this workload it was the wrong signal.

A translation worker sends text to a model provider (Bedrock, OpenAI, Gemini) and waits. A worker blocked on a slow provider call looks idle to CPU while it is in the middle of a job. Ten of them look like a fleet with spare capacity, so the autoscaler lowers the desired count, and ECS has no way to know which of the tasks it stops is holding a half-done translation. CPU told us little about whether there was work to do, and nothing at all about which tasks were safe to stop.

## What ECS does when it stops a task

The obvious fix lives in the stop sequence, so it is worth being exact about it.

The `StopTask` reference describes the sequence: each container gets a stop signal, `SIGTERM` unless the image sets a different `STOPSIGNAL`, and anything still running when the timeout ends gets `SIGKILL`. The timeout is the container's `stopTimeout`, "time duration (in seconds) to wait before the container is forcefully killed if it doesn't exit normally on its own." On Fargate it defaults to 30 seconds. The maximum is 120.

So a shutdown handler gets two minutes at most. A worker that catches `SIGTERM` can stop pulling work and finish anything short. It cannot finish the last 90 minutes of a two-hour job.

What happens to the job next is quiet, which is why nothing failed loudly. On SQS, a received message stays invisible to other consumers for its visibility timeout, and if nobody deletes it before that runs out it becomes visible again and another worker picks it up. The safety net catches the job, and the job starts over from zero, every minute of the first attempt paid for and discarded. If it had side effects, they run twice. If the retries reach the queue's `maxReceiveCount`, the message lands in the dead-letter queue, a failure the platform caused and someone else has to explain.

## The fixes I could not use

I could not simply stop scaling in. That means paying for a fleet sized for the worst case all day, and with peaks of 500K jobs an hour against a 5K baseline, a fleet sized for the peak would be almost entirely idle at baseline. It gives up the point of autoscaling.

Making every job resumable was out of reach. That is a rewrite of how translation state is tracked, and it is the kind of project that quietly becomes a quarter. The team could not freeze feature work around it.

A longer `stopTimeout` is the knob everyone reaches for first, and on Fargate it tops out at 120 seconds. It covers the 30-second jobs and nothing else. It is also the wrong shape of fix. It asks a task to finish in the window after ECS has already decided to kill it, when the real problem is that ECS picked a busy task at all.

One task per job, launched with `RunTask` and gone when the job ends, takes scale-in out of the picture: nothing is stopped mid-job because nothing is ever stopped. It is the wrong fit for this mix of job sizes. A 30-second translation behind a Fargate cold start is mostly cold start, and I would expect the `RunTask` call rate to become the ceiling long before 500K jobs an hour. If the jobs were hours long and rare, I would use AWS Batch, which already works this way, and stop there.

The cheap options were worse. What I needed was a shutdown that did not throw work away.

## Queue depth to scale, a drain before every stop

I replaced the default autoscaler with a queue-depth autoscaler on Lambda. Queue depth is the honest signal. It measures work waiting, not the CPU fingerprint of tasks sitting on a provider.

The second half mattered more. On scale-in, the scaler told workers to drain. A task stopped taking new jobs, finished the one it was on, and exited. Only then was it stopped. The scaler's deployment state lived in DynamoDB. That setup carried the fleet through peaks of 500K jobs an hour without killing jobs mid-run.

The production code stays with the product. Since then I have written the approach up again as an open-source design, [ecs-drain-scaler](https://github.com/abdelwahab313/ecs-drain-scaler), with each AWS behaviour it depends on traced to the docs. Writing it up showed me that on Fargate, "drain" is subtler than the word suggests. The rest of this post uses that design to show the mechanism. It is a design-stage rework, ADRs plus a tested scaling policy, nothing deployable yet, and it is not the system that ran in production.

## Telling ECS which task is busy

Drain means what it means for a load balancer: stop sending new work, let the work in progress finish, then remove the node. On Fargate the "let it finish" part cannot come from the stop signal, because of the 120-second cap. It has to come from ECS never choosing a busy task in the first place.

![Two timelines for the same two-hour job. Default scale-in sends SIGTERM, waits at most 120 seconds, then SIGKILLs the task and the rest of the job is lost. With scale-in protection the task is skipped, the job finishes, the task unprotects and only then stops.](diagram:fargate-stop-vs-drain)

ECS has a feature for exactly this: task scale-in protection. A protected task is not terminated by "scale-in events from either service auto scaling or deployments." The AWS page even uses this post's case as its first example, a queue-processing application where some tasks need to run for hours while overall utilization is low.

A task can protect itself through the ECS container agent, which injects `ECS_AGENT_URI` into the task's containers. AWS recommends this path for queue workers, because the agent has its own retries. The call is one HTTP request:

```sh
curl --request PUT --header 'Content-Type: application/json' \
  "${ECS_AGENT_URI}/task-protection/v1/state" \
  --data '{"ProtectionEnabled":true,"ExpiresInMinutes":135}'
```

Read the body, not just the status. Success comes back as `protection.ProtectionEnabled: true` with an `ExpirationDate`; a refusal comes back with a `failure.Reason`. The task role needs `ecs:GetTaskProtection` and `ecs:UpdateTaskProtection` even though the container only talks to the agent. The feature needs agent 1.65.0 or later; the docs state it by agent version, not by Fargate platform version, so the first thing I would log in a new environment is whether the variable is there.

Protection lasts from 1 to 2,880 minutes. Leave the expiry out and you get 120 minutes, which is a trap for this workload all by itself: a job that runs the full two hours outlives its protection by however long the dequeue and the cleanup take. Derive the expiry from the job's timeout plus a margin.

Calling the endpoint again on a protected task resets the expiry, so it is tempting to protect at boot and renew forever. Do not. An idle task that is protected cannot be scaled in, and, as the next section shows, it holds up every deployment too. The rule is short: protect after receiving a message and before starting it, unprotect the moment it ends, success or failure. An idle task is always stoppable.

Here is that loop as a Ruby sketch. It is the shape of the protocol from the rework's ADRs, not production code:

```ruby
require "aws-sdk-sqs"
require "json"
require "net/http"

QUEUE   = ENV.fetch("QUEUE_URL")
AGENT   = URI("#{ENV.fetch('ECS_AGENT_URI')}/task-protection/v1/state")
JOB_MAX = 120 * 60   # longest job, seconds
PROTECT = 135        # minutes: JOB_MAX plus margin, under the 3-hour CloudFormation window

$stopping = false
Signal.trap("TERM") { $stopping = true }   # stop taking work; finishing is protection's job
sqs = Aws::SQS::Client.new

def protection(enabled, minutes: nil)
  body = { "ProtectionEnabled" => enabled }
  body["ExpiresInMinutes"] = minutes if minutes
  req = Net::HTTP::Put.new(AGENT, "Content-Type" => "application/json")
  req.body = body.to_json
  res = Net::HTTP.start(AGENT.host, AGENT.port) { |http| http.request(req) }
  JSON.parse(res.body).dig("protection", "ProtectionEnabled") == enabled
end

until $stopping
  msg = sqs.receive_message(queue_url: QUEUE, max_number_of_messages: 1,
                            wait_time_seconds: 20).messages.first
  next unless msg

  unless protection(true, minutes: PROTECT) && !$stopping
    # refused (DEPLOYMENT_BLOCKED, throttling) or told to stop: hand the message back
    protection(false)
    sqs.change_message_visibility(queue_url: QUEUE, receipt_handle: msg.receipt_handle,
                                  visibility_timeout: 0)
    next
  end

  heartbeat = Thread.new do
    loop do
      sleep 60
      sqs.change_message_visibility(queue_url: QUEUE, receipt_handle: msg.receipt_handle,
                                    visibility_timeout: 300)
    end
  end

  begin
    translate(JSON.parse(msg.body), deadline: Time.now + JOB_MAX)
    sqs.delete_message(queue_url: QUEUE, receipt_handle: msg.receipt_handle)
  ensure
    heartbeat.kill
    protection(false)
  end
end
```

The order is the design. Receive, protect, check the stop flag again (ECS may have decided to stop this task while the protect call was in flight), and only then work. A job never runs unprotected.

The heartbeat keeps the message invisible while the job runs, which is what the SQS docs recommend for long work. It has a ceiling you will not hit here but should know about: visibility maxes out at 12 hours from the first receive, and extending it does not reset that clock.

`SIGTERM` stops intake and nothing more. If it arrives mid-job, protection did not hold: it expired, or the stop is one protection does not cover. The sketch hands a refused message straight back, which costs one receive against `maxReceiveCount`; the rework retries the protect call with backoff first. And `translate` has to honour its deadline. A job killed at its deadline is a visible failure. A job still running after its protection lapsed is a silent one.

## Protected tasks hold deployments open

Protection has a cost, and it lands on deployments. On a rolling update, ECS starts new tasks but does not stop old ones until their protection clears or expires. `maximumPercent` decides whether the new revision can start alongside them.

It gets worse at the edges. If the service has more protected tasks than its desired count, the next protect call fails with `DEPLOYMENT_BLOCKED`. AWS lists three ways out: wait for protection to expire, unprotect some tasks, or raise the desired count above the protected count. And if you deploy with CloudFormation, the stack update has a 3-hour timeout, so protection longer than that "may result in failure and rollback." That is why the sketch protects for a bit over two hours and not the 48 hours the API allows.

"Deployed" has to split in two. The new revision taking work should take minutes. The deployment reaching completion cannot happen until the longest job that was running when it started has finished. Any design that refuses to kill jobs has that bound. Once you name it, it stops looking like a bug.

One more failure needs a rule of its own. An old-revision task that finishes a job, unprotects and immediately takes the next message can protect itself again before ECS gets round to stopping it. Under steady load, that holds the deployment open indefinitely. The docs do not say how long ECS takes to stop an old task after its protection clears, so I would not bet on winning that race. In the rework, the worker checks before each poll, at most every 30 seconds, whether its task definition is still the service's `PRIMARY` deployment. When it is not, it exits once idle and ECS replaces it with the new revision.

The service side, as a Terraform sketch:

```hcl
resource "aws_ecs_service" "workers" {
  name            = "translate-workers"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  # a full new revision can start while old tasks finish their protected jobs
  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  # a rollout can stay open as long as the longest running job; don't hold the apply
  wait_for_steady_state = false

  network_configuration {
    subnets = var.private_subnet_ids
  }

  lifecycle {
    ignore_changes = [desired_count] # the scaler owns this number
  }
}

data "aws_iam_policy_document" "worker_task_protection" {
  statement {
    actions   = ["ecs:GetTaskProtection", "ecs:UpdateTaskProtection"]
    resources = ["arn:aws:ecs:${var.region}:${var.account_id}:task/${var.cluster_name}/*"]
  }
}
```

At 200 percent, a full replacement fleet can run next to the old one for as long as the longest old job runs. That is up to double the task count during a deployment, and it is the price of never killing a job to ship code.

## Scaling on backlog, with a floor under it

The scaler's job shrinks once workers protect themselves. It moves one number, the desired count, and never chooses a task.

The rework's policy, from its ADR:

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

Counting in-flight messages matters more than it looks. On a queue where every message is already being worked, the visible count is zero. A scaler that reads only visible messages sees an empty queue and lowers the desired count under a fleet that is completely busy. With protection in place, ECS will not stop those tasks, but the desired count now sits below the protected count, and the next worker to receive a message gets `DEPLOYMENT_BLOCKED` when it tries to protect itself. The floor at the protected count is what keeps that from happening, and the scaler reads it from ECS exactly rather than estimating it.

The deadband makes scale-in use a stricter target than scale-out, so the fleet does not oscillate around a threshold. Approximate is the right word for the SQS counts, too: the docs say they may not be consistent until at least a minute after producers stop. Cooldowns and step caps turn that lag into a slightly slow response rather than a wrong one.

The closest native option is a target-tracking policy with metric math, and AWS documents exactly this signal: `ApproximateNumberOfMessagesVisible` divided by `RunningTaskCount` from Container Insights. To be fair to it, Application Auto Scaling already turns off scale-in while an ECS deployment is in progress, so that rule comes free. What it cannot do is floor at the protected count, and its documented expression reads only visible messages. For a fleet of short jobs, I would use it and not write a scaler at all.

## Spot stops are not scale-in

I owned that platform and its Terraform for a year and a half, and ran the worker fleet 90% on Spot. Spot makes shutdowns routine rather than exceptional, which is exactly why drain has to be part of the scaler and not a hope.

It is also where drain runs out. A Fargate Spot interruption comes with a two-minute warning, sent as a task state change event to EventBridge and as `SIGTERM` to the task. Protection covers scale-in from service auto scaling and deployments. A Spot interruption is neither, and a two-hour job does not finish in two minutes. For those stops, the queue's retry is the only net. What drain guarantees is narrower and still worth a lot: the scaler is never the thing that kills a job. The rework leaves Spot handling out of its first version for this reason. It needs its own design.

## What it cost

Draining means a few idle minutes on shutdown. That is the trade: a short delay while a task finishes its job, instead of throwing away up to 2 hours of work.

The rest of the bill is less visible. Deployments finish when the longest old job finishes, and at 200 percent they can double the fleet while they wait. The scaler is now a piece of software you own, with its own failure modes; the rework's answer is that any error means no change to the desired count, plus an alarm that fires when the scaler has not run for ten minutes, because a disabled schedule fails silently.

It is the wrong call in three places. For short jobs, use the native metric-math policy and a sensible `stopTimeout`. If you already run Kubernetes, KEDA and a long termination grace period solve most of this without a custom scaler. And if your jobs are hours long and rare, run one task per job and skip scale-in entirely.

## The scaler should not be able to kill anything

My rule now is that the thing which scales a worker fleet should only move a number. The only thing that knows a task is busy is the worker holding the message, so the worker is the one that says so, and the scaler's IAM policy carries no `ecs:StopTask` and no `ecs:UpdateTaskProtection`. That policy is the proof, not a comment promising it.

If a shutdown can throw away non-trivial work, ask who picks the task that stops, and whether it can see which tasks are busy. If the answer is "the autoscaler, and no", the signal you scale on is the smaller problem.

## Sources

- Amazon ECS, task scale-in protection: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-scale-in-protection.html
- Amazon ECS, task scale-in protection endpoint: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-scale-in-protection-endpoint.html
- Amazon ECS API, `UpdateTaskProtection`: https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_UpdateTaskProtection.html
- Amazon ECS API, `StopTask` (stop signal and `SIGKILL`): https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_StopTask.html
- Amazon ECS, task definition parameters for Fargate (`stopTimeout`): https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html
- Amazon ECS, Fargate Spot termination notices: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html
- Amazon ECS, service auto scaling and deployments: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html
- Application Auto Scaling, target tracking with metric math (SQS backlog per task): https://docs.aws.amazon.com/autoscaling/application/userguide/application-auto-scaling-target-tracking-metric-math.html
- Amazon SQS, visibility timeout: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html
- Amazon SQS API, `GetQueueAttributes` (approximate counts, `maxReceiveCount`): https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_GetQueueAttributes.html
- ecs-drain-scaler, README and ADRs 0001 to 0005: https://github.com/abdelwahab313/ecs-drain-scaler
