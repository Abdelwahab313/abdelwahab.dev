---
title: "Building a booking marketplace from empty repo to beta"
kind: case-study
status: published
date: 2026-10-13
order: 0
lede: 'A booking marketplace from empty repo to beta: a deploy gate in week one, and a Postgres exclusion constraint that rejects double bookings.'
tags: [rails, react, ci]
cover: /img/blog/zero-to-launch.svg
coverAlt: One mentor's hours from 10:00 to 12:00, with a confirmed booking from 10:00 to 11:00 and a dashed, rejected booking from 10:30 to 11:30 overlapping it.
---

## Situation

The product was a knowledge marketplace: business advisors on one side, companies that need their expertise on the other. When I joined there was nothing to run. No MVP, no deploy pipeline, no cloud infrastructure. The job was to get from an empty repo to a beta launch with a small team, and I built it full stack in React and Ruby on Rails on Postgres, along with the infrastructure and pipelines it shipped on. One flow could break the product: a company picks an advisor's hour, and both of them end up with a Zoom meeting. Two companies confirmed for the same advisor at the same hour means one of them waits in a meeting that will never start, and the advisor looks unreliable on a platform whose whole job is to make them look reliable. So the first-week question was what had to be true before any feature could ship.

My answer had two parts: a pipeline that deploys nothing its browser specs have not passed, and a booking rule enforced by Postgres itself, so that a race between two requests ends in an error the UI can explain.

## Decision

Two things went in before the product did much at all: a CI/CD pipeline, and BDD tests in Cypress, written from the user's side of the screen. After that I led features from business requirements to deployment, backend and frontend. The code here is a sketch written for this post, not the code that shipped, though the SQL targets Postgres, the engine the product ran on. In the booking flow an advisor is a mentor, and the code uses that word.

### A deploy gate before the first feature

A week-one pipeline does very little. It starts a database, runs whatever specs exist, and deploys `main` if they pass. On day one that might be a single spec, a visitor can sign up, and that is enough. The point is that the gate exists before there is any code that would fail it.

```yaml
on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres
        env:
          POSTGRES_PASSWORD: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    # steps: checkout, setup-ruby, db:prepare, then Cypress against the Rails server

  deploy:
    needs: e2e
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: bin/deploy
```

The policy lives in one line, `needs: e2e`. GitHub's workflow docs say that if a job fails or is skipped, every job that needs it is skipped, so nothing reaches a server that the specs have not seen. The `services` block gives the job a real Postgres on `localhost:5432`, health-checked with `pg_isready` before the steps run. A rule that lives in the database is only tested if the test database is real, and the booking rule below lives in the database.

Here is the opinion I would defend in a design review: CI added in month six costs more than CI added in week one, even though it is the same YAML. In month six it has to pass on code that was never written to pass it. Seeds that only work on one laptop, specs that depend on the order they run in, a setup step nobody wrote down. All of that is cheap to prevent and slow to dig out.

### An exclusion constraint for overlap

The obvious booking endpoint checks whether the slot is free and then inserts. That is check-then-write, the same gap as the Redis stock counter in [a different post](/blog/preventing-stock-overselling-in-redis-with-lua-scripts). Two requests both check, both see a free slot, both insert. A uniqueness validation in the model has the same gap, because underneath it is the same `SELECT` followed by the same `INSERT`.

A unique index on `(mentor_id, starts_at)` closes part of it. It stops two bookings at exactly 10:00 and lets one at 10:00 and one at 10:30 through. The rule is about overlap, and Postgres can enforce overlap directly with an exclusion constraint:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE bookings (
  id              bigserial   PRIMARY KEY,
  mentor_id       bigint      NOT NULL REFERENCES mentors (id),
  client_id       bigint      NOT NULL REFERENCES clients (id),
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  status          text        NOT NULL DEFAULT 'confirmed',
  zoom_meeting_id bigint,
  join_url        text,
  CHECK (ends_at > starts_at),
  CONSTRAINT bookings_no_overlap
    EXCLUDE USING gist (mentor_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
    WHERE (status <> 'cancelled')
);
```

Read it as: no two rows may have the same `mentor_id` and overlapping time ranges, unless one of them is cancelled. `btree_gist` gives GiST an equality operator for `bigint`, so the mentor and the range share one constraint. It is a trusted extension, so a non-superuser with `CREATE` on the database can install it, which matters on a managed database. `tstzrange` defaults to `[)` bounds, so a 10:00 to 11:00 session and an 11:00 to 12:00 one do not overlap, and the `WHERE` clause frees the slot when a booking is cancelled.

One Rails default is why I write this table in SQL by hand: the Active Record PostgreSQL guide says datetime columns default to `timestamp without time zone`, and a booking table is the last place I want a timestamp that has forgotten its zone.

![Three bookings for one mentor on the same timeline. The 10:30 to 11:30 request overlaps the confirmed 10:00 to 11:00 session, so the exclusion constraint rejects it, while a unique index on starts_at would have let it through. The 11:00 to 12:00 session starts exactly where the first ends and is accepted, because the range's upper bound is exclusive.](diagram:launch-overlap-ranges)

### What the second session sees

Run this sketch against Postgres 17 with two sessions booking the same mentor at the same time, and the one property that matters shows up. The second session's own check, a plain `SELECT` for overlapping rows, returns zero, because the first has not committed yet. Its `INSERT` then waits on the first transaction and, the moment that commits, fails with SQLSTATE `23P01`, `exclusion_violation`. The application check is fooled. The constraint is not.

![Two sessions booking the same mentor, as a sequence. Both SELECT for overlapping rows and both see none, because the first has not committed. The second INSERT waits on the first transaction and fails with 23P01 once it commits. Without the constraint the second row would have been inserted, double booking the mentor.](diagram:launch-race-sequence)

Current Rails maps that error to `ActiveRecord::ExclusionViolation`, a subclass of `ActiveRecord::StatementInvalid`; on a Rails that predates the class, it arrives as the plain parent. The controller turns it into a `409`:

```ruby
class BookingsController < ApplicationController
  def create
    starts_at = Time.iso8601(params.require(:starts_at))
    booking = Booking.create!(
      mentor_id: params.require(:mentor_id),
      client:    current_client,
      starts_at: starts_at,
      ends_at:   starts_at + 1.hour
    )
    CreateMeetingJob.perform_later(booking.id)
    render json: booking, status: :created
  rescue ActiveRecord::ExclusionViolation
    render json: { error: "slot_taken" }, status: :conflict
  end
end
```

`CreateMeetingJob` runs after the row commits, because a transaction held open across an HTTP call to Zoom puts someone else's latency inside your lock, and a retried job checks `zoom_meeting_id` first so it does not create a second meeting.

The UI shows that `409` as "That time was just booked", and this is the spec that checks it:

```js
// cypress/e2e/booking.cy.js
describe('Booking a mentor', () => {
  beforeEach(() => {
    cy.request('POST', '/test/seed', { scenario: 'mentor_open_tuesday' })
    cy.request('POST', '/test/login', { role: 'company' })
  })

  context('when another company books the same slot first', () => {
    it('says the time was taken instead of booking twice', () => {
      cy.visit('/mentors/1')
      cy.request('POST', '/test/book', { mentor_id: 1, slot: 'tue-10:00' })
      cy.contains('button', 'Tue 10:00').click()
      cy.contains('button', 'Confirm booking').click()
      cy.contains('That time was just booked').should('be.visible')
    })
  })
})
```

State is seeded with `cy.request` against test-only endpoints, as Cypress's best-practices page recommends, and the spec creates its own conflicting booking after the page has loaded, which is the stale-page race a real user hits. Any spec that books a slot reaches Zoom from the Rails server, where `cy.intercept` cannot see it, so the test environment swaps in a fake Zoom client that returns a canned `join_url`.

## Trade-off

The first cost was time. Pipeline and specs went in before there was a feature anyone could click, and the first week demoed worse than it would have. None of this is the right call for every MVP. If the first version is an experiment to find out whether anyone wants the thing, with a person behind a form doing the matching, a week on pipelines is a week not learning. Here the first version was the booking flow, so the tests were tests of the product itself.

The exclusion constraint has costs a validation does not. It ties the rule to Postgres. With Postgres as the database that cost nothing at the time, but it is one more thing any later database move would have to carry. It turns a business rule into schema, so "leave 15 minutes between sessions" becomes a migration that changes the range expression. And it surfaces as an exception the controller has to translate, which is easy to forget in a second endpoint that writes bookings.

It also only covers rows in our table. An advisor accepting a meeting in their own calendar is outside our transaction, and checking their calendar again just before the insert narrows that window without closing it. I would accept that. A collision with an outside calendar is an annoyed advisor, and it is visible to them before the meeting. A collision inside our own table is two companies who both did everything right.

## Outcome

The marketplace went from the first MVP to a beta launch, with the cloud infrastructure and deploy pipelines behind it.

If I kept one artifact from all of this, it would be the Cypress spec where another company gets to the slot first. Find the promise your product makes between two people, a slot or a seat or a unit of stock. Put the rule that keeps it where concurrent requests meet, which is the database. Then make your first end-to-end test the one that tries to break it.

## Sources

- PostgreSQL docs, Range Types and "Constraints on Ranges": https://www.postgresql.org/docs/current/rangetypes.html
- PostgreSQL docs, `btree_gist`: https://www.postgresql.org/docs/current/btree-gist.html
- PostgreSQL docs, error codes (`23P01 exclusion_violation`): https://www.postgresql.org/docs/current/errcodes-appendix.html
- Rails guide, Active Record and PostgreSQL (range types, exclusion constraints, `datetime_type`): https://guides.rubyonrails.org/active_record_postgresql.html
- Cypress docs, Best Practices: https://docs.cypress.io/app/core-concepts/best-practices
- GitHub Actions docs, workflow syntax (`needs`, `if`): https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
