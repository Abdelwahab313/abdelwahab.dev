---
title: "Building a booking marketplace from empty repo to beta"
kind: case-study
status: published
date: 2026-10-13
order: 0
lede: 'A booking marketplace from empty repo to beta. Why CI came in week one, and why double booking is a database problem, not a UI check.'
tags: [rails, react, ci]
cover: /img/blog/zero-to-launch.svg
coverAlt: One mentor's hours from 10:00 to 12:00, with a confirmed booking from 10:00 to 11:00 and a dashed, rejected booking from 10:30 to 11:30 overlapping it.
---

## Situation

The product was a knowledge marketplace: business advisors on one side, companies that need their expertise on the other. When I joined there was nothing to run. No MVP, no deploy pipeline, no cloud infrastructure. The job was to get from an empty repo to a beta launch with a small team, and I built it full stack in React and Ruby on Rails on a Postgres database, along with the infrastructure and pipelines it shipped on.

Most of a marketplace like this is ordinary web work. Profiles, search, sign-up. One flow was not. A company finds an advisor, picks a time, and both of them end up with a meeting. I built that as an internal calendar for mentor availability and customer booking, with Zoom, ClickUp and calendar integrations around it. In the booking flow an advisor is a mentor, and the code below uses that word.

That flow is where a two-sided marketplace keeps its promise or breaks it. A profile page that renders badly costs a squint. Two companies confirmed for the same advisor at the same hour means one of them waits in a meeting that will never start, and the advisor looks unreliable on a platform whose whole job is to make them look reliable.

A broken calendar is a broken site. So the first-week question was not which feature to build first. It was what had to be true before any feature could ship.

## Decision

Two things went in before the product did much at all: a CI/CD pipeline, and BDD tests in Cypress, written from the user's side of the screen. After that I led features from business requirements to deployment, backend and frontend.

The database was Postgres, so the SQL below targets the engine the product actually ran on. Everything else is a sketch of the approach, written for this post in Rails, Cypress and GitHub Actions syntax. None of it is the code that shipped, and the provider names in it are illustration, not a record of what the product used. The shapes are the point.

### A pipeline with one test is still a gate

A week-one pipeline does very little. It checks out the code, starts a database, runs whatever specs exist, and deploys `main` if they pass. On day one the specs that exist might be a single one: a visitor can sign up. That is enough. The value is not the test. It is that the gate exists before there is any code that would fail it.

```yaml
name: ci
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
    env:
      RAILS_ENV: test
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/app_test
    steps:
      - uses: actions/checkout@v6
      - uses: ruby/setup-ruby@v1
        with:
          bundler-cache: true
      - run: bin/rails db:prepare
      - uses: cypress-io/github-action@v7
        with:
          start: bin/rails server -p 3000
          wait-on: 'http://localhost:3000'

  deploy:
    needs: e2e
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: bin/deploy
```

The policy lives in one line, `needs: e2e`. GitHub's workflow docs say that if a job fails or is skipped, every job that needs it is skipped. Nothing reaches a server that the specs have not seen. The `bin/deploy` step is whatever your cloud wants, and it is deliberately the least interesting line in the file.

The `services` block matters more than it looks. It gives the job a real Postgres, the same engine as the product's database, on `localhost:5432`, health-checked with `pg_isready` before the steps run. A rule that lives in the database is only tested if the test database is real, and the booking rule below lives in the database.

![The week-one pipeline as a sketch. A push or pull request runs the e2e job against a real, health-checked Postgres, and the deploy job runs only on main and only when that job passes. If a spec fails, deploy is skipped.](diagram:launch-ci-gate)

Here is the opinion I would defend in a design review: CI added in month six costs more than CI added in week one, even though it is the same YAML. In month six it has to pass on code that was never written to pass it. Seeds that only work on one laptop, specs that depend on the order they run in, a setup step nobody wrote down. All of that is cheap to prevent and slow to dig out.

### Behaviour specs with two people in them

BDD in Cypress means less ceremony than the term suggests. Cypress borrows its test interface from Mocha (`describe`, `context`, `it`) and supports Chai's BDD assertion style (`expect`, `should`). There is no Gherkin unless you add it. What makes a spec behaviour-driven is what you write in the `it`: a sentence a product person would sign off on.

In a marketplace the sentences worth writing have two people in them.

```js
// cypress/e2e/booking.cy.js
describe('Booking a mentor', () => {
  beforeEach(() => {
    cy.request('POST', '/test/seed', { scenario: 'mentor_open_tuesday' })
    cy.request('POST', '/test/login', { role: 'company' })
  })

  context('when the slot is free', () => {
    it('confirms the booking and shows the meeting link', () => {
      cy.visit('/mentors/1')
      cy.contains('button', 'Tue 10:00').click()
      cy.contains('button', 'Confirm booking').click()
      cy.contains('Booking confirmed').should('be.visible')
      cy.get('[data-cy=meeting-link]')
        .should('have.attr', 'href')
        .and('include', 'zoom')
    })
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

Two choices in that spec come from Cypress's own best-practices page. State is set with `cy.request` against test-only endpoints instead of being clicked into place, so each spec gets to its starting point programmatically. And no spec depends on another: the second one creates its own conflicting booking after the page has loaded, which is exactly the stale-page race a real user hits.

The trap is the third parties. `cy.intercept` only intercepts requests made by the front end. The call that creates a Zoom meeting comes from the Rails server, so Cypress never sees it, and a spec that books a slot will create a real meeting on a real account unless the server stops it. The fake has to live server-side: in the test environment, Rails swaps the Zoom client for one that returns a canned `join_url`, and the same goes for any calendar API. Cypress drives the browser. The server decides who it talks to.

### Double booking is a database problem

The obvious booking endpoint checks whether the slot is free and then inserts. That is check-then-write, the same gap as the Redis stock counter in [a different post](/blog/preventing-stock-overselling-in-redis-with-lua-scripts). Two requests both check, both see a free slot, both insert. A uniqueness validation in the model has the same gap, because underneath it is the same `SELECT` followed by the same `INSERT`.

A unique index on `(mentor_id, starts_at)` closes part of it. It stops two bookings at exactly 10:00 and lets one at 10:00 and one at 10:30 through. The rule is overlap, not equality, and Postgres can enforce overlap directly with an exclusion constraint:

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

Read it as: no two rows may have the same `mentor_id` and overlapping time ranges, unless one of them is cancelled. `btree_gist` gives GiST an equality operator for plain types like `bigint`, so the mentor and the range can share one constraint. It is marked trusted, so a non-superuser with `CREATE` on the database can install it, which matters on a managed database. `tstzrange(starts_at, ends_at)` defaults to `[)` bounds, lower inclusive and upper exclusive, so a 10:00 to 11:00 session and an 11:00 to 12:00 session do not overlap and back-to-back bookings need no fudged minutes. The `WHERE` clause makes it a partial constraint, so cancelling a booking frees the slot.

![Three bookings for one mentor on the same timeline. The 10:30 to 11:30 request overlaps the confirmed 10:00 to 11:00 session, so the exclusion constraint rejects it, while a unique index on starts_at would have let it through. The 11:00 to 12:00 session starts exactly where the first ends and is accepted, because the range's upper bound is exclusive.](diagram:launch-overlap-ranges)

Run this sketch against Postgres 17 with two sessions booking the same mentor at the same time, and the one property that matters shows up. The second session's own check, a plain `SELECT` for overlapping rows, returns zero, because the first has not committed yet. Its `INSERT` then waits on the first transaction and, the moment that commits, fails with SQLSTATE `23P01`, `exclusion_violation`. The application check is fooled. The constraint is not.

![Two sessions booking the same mentor, as a sequence. Both SELECT for overlapping rows and both see none, because the first has not committed. The second INSERT waits on the first transaction and fails with 23P01 once it commits. Without the constraint the second row would have been inserted, double booking the mentor.](diagram:launch-race-sequence)

Current Rails maps that error to `ActiveRecord::ExclusionViolation`, a subclass of `ActiveRecord::StatementInvalid`; on a Rails that predates the class, it arrives as the plain parent. The controller turns it into a `409`, and the UI says the time was just booked, which is what the second Cypress spec asserts:

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

One Rails detail pushes me to write this table in SQL by hand. The Active Record PostgreSQL guide says datetime columns default to `timestamp without time zone` for legacy reasons, and switching to `timestamptz` has to be configured before new migrations use it. A booking table is the last place I want a timestamp that has forgotten its zone.

### Instants in the table, wall-clock rules for availability

Once a meeting is a Zoom link, the two people in it do not have to share a city, so they do not have to share a clock. A booking is an instant. Postgres stores `timestamptz` internally as UTC and converts to the session's zone on output, so the table above never has to know where anyone lives.

Availability is not an instant. "Tuesdays from 9 in New York" is a rule in a local zone, and the UTC time it means moves when daylight saving does:

```ruby
zone = ActiveSupport::TimeZone["America/New_York"]
zone.local(2021, 3, 12, 9, 0).utc   # => 2021-03-12 14:00:00 UTC
zone.local(2021, 3, 15, 9, 0).utc   # => 2021-03-15 13:00:00 UTC
```

Same 9:00 on the advisor's wall, one weekend apart, an hour different in UTC. Postgres gives the same two instants for `AT TIME ZONE 'America/New_York'`. The Postgres docs put the reason plainly: an abbreviation like `EST` is a fixed offset, while a full name like `America/New_York` implies a set of daylight-saving rules. So availability is stored as wall-clock times plus an IANA zone name, never as an offset, and expanded into UTC instants one date at a time in the advisor's zone. The viewer's zone only matters at render.

The same discipline applies at every edge. Zoom's create-meeting endpoint accepts `start_time` either in GMT as `yyyy-MM-ddTHH:mm:ssZ` or as local time plus a `timezone` ID, and without a `timezone` it uses the Zoom account's zone. The sharper edge is in the same field description: if `start_time` is missing or in the past, it defaults to the current time. A time-zone bug upstream does not fail the call. It creates a meeting that starts now. So the request always carries UTC with the `Z`:

```json
{
  "topic": "Advisory session",
  "type": 2,
  "start_time": "2021-03-15T13:00:00Z",
  "duration": 60
}
```

Type `2` is a scheduled meeting, and `duration` is in minutes.

External calendars fit the same model. Google Calendar's `freeBusy.query` is a clean example: it returns only busy intervals, each with an inclusive start and an exclusive end. That is the same `[)` convention as the range in the constraint, so busy blocks and bookings compare without off-by-one fixes. A slot is checked against them when it is listed and again just before the insert.

### The meeting is created after the commit

`CreateMeetingJob` runs after the booking row has committed, never inside the transaction. Holding a database transaction open across an HTTP call to Zoom puts someone else's latency inside your lock, and a rollback cannot un-create a meeting anyway.

```ruby
class CreateMeetingJob < ApplicationJob
  def perform(booking_id)
    booking = Booking.find(booking_id)
    return if booking.zoom_meeting_id.present?

    meeting = ZoomClient.create_meeting(
      user_id:    booking.mentor.zoom_user_id,
      start_time: booking.starts_at.utc.iso8601,
      duration:   60
    )
    booking.update!(zoom_meeting_id: meeting.fetch("id"),
                    join_url:        meeting.fetch("join_url"))
  end
end
```

Every `POST` to Zoom creates a new meeting, so a retried job has to know whether the first attempt got that far. The guard is the `zoom_meeting_id` column: once it is set, the job is a no-op.

## Trade-off

The first cost is the obvious one. Pipeline and specs take time before there is a feature anyone can click, and the first week demos worse than it would have. The alternative was to move fast and backfill the safety net later. In this product that meant shipping the booking flow without tests, and the booking flow was the product.

End-to-end specs are slow. Each one is a browser, a Rails server and a database, and a suite of them grows into minutes. I think the answer is to keep them for sentences with two people in them, booking, cancelling, the slot someone else took first, and push everything else into faster tests closer to the code.

The fakes have a hole. A spec with a fake Zoom client proves our side of the conversation and nothing about Zoom's. It cannot tell you that a field was renamed or a token expired. That gap closes outside CI, with a real booking on a staging account, and it is worth saying out loud that it is a manual step.

The exclusion constraint has costs a validation does not. It ties the rule to Postgres. With Postgres as the database that cost nothing at the time, but it is one more thing any later database move would have to carry. It turns a business rule into schema, so "leave 15 minutes between sessions" becomes a migration that changes the range expression, not a one-line model change. And it surfaces as an exception the controller has to translate, which is easy to forget in a second endpoint that writes bookings.

It also only covers rows in our table. An advisor accepting a meeting in their own calendar is outside our transaction, and the second free/busy check narrows that window without closing it. I would accept that. A collision with an outside calendar is an annoyed advisor, and it is visible to them before the meeting. A collision inside our own table is two companies who both did everything right.

The meeting guard is not airtight either. If Zoom creates the meeting and the `update!` then fails, the retry creates a second meeting. The cost of that hole is an orphan meeting on the advisor's account, which is cheap next to a double-booked person.

And none of this is the right call for every MVP. If the first version is an experiment to find out whether anyone wants the thing, with a person behind a form doing the matching, a week on pipelines is a week not learning. Here the first version was the booking flow, so the tests were tests of the product itself.

## Outcome

The marketplace went from the first MVP to a beta launch, with the cloud infrastructure and deploy pipelines behind it. Later I moved the web apps to a SaaS model. I think a change with that reach is the strongest case for writing the specs early. By the time a change touches most of the product, you want the description of what the product promises to exist already, not to be written in the same sprint as the change.

If I kept one artifact from all of this, it would be the second Cypress spec, the one where another company gets to the slot first. Find the promise your product makes between two people, a slot or a seat or a unit of stock. Put the rule that keeps it where concurrent requests meet, which is the database. Then make your first end-to-end test the one that tries to break it.

## Sources

- PostgreSQL docs, Range Types and "Constraints on Ranges": https://www.postgresql.org/docs/current/rangetypes.html
- PostgreSQL docs, `CREATE TABLE` (`EXCLUDE`, partial predicate, deferrable): https://www.postgresql.org/docs/current/sql-createtable.html
- PostgreSQL docs, `btree_gist`: https://www.postgresql.org/docs/current/btree-gist.html
- PostgreSQL docs, error codes (`23P01 exclusion_violation`): https://www.postgresql.org/docs/current/errcodes-appendix.html
- PostgreSQL docs, date/time types and time zones: https://www.postgresql.org/docs/current/datatype-datetime.html
- Rails guide, Active Record and PostgreSQL (range types, exclusion constraints, `datetime_type`): https://guides.rubyonrails.org/active_record_postgresql.html
- Rails API, `ActiveRecord::ExclusionViolation`: https://api.rubyonrails.org/classes/ActiveRecord/ExclusionViolation.html
- Rails API, `ActiveSupport::TimeWithZone`: https://api.rubyonrails.org/classes/ActiveSupport/TimeWithZone.html
- Zoom API, Create a meeting (`start_time`, `timezone`, `type`, `duration`): https://developers.zoom.us/docs/api/meetings/
- Google Calendar API, `freeBusy.query`: https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
- Cypress docs, Writing and Organizing Tests: https://docs.cypress.io/app/core-concepts/writing-and-organizing-tests
- Cypress docs, Best Practices: https://docs.cypress.io/app/core-concepts/best-practices
- Cypress docs, `cy.intercept`: https://docs.cypress.io/api/commands/intercept
- GitHub Actions docs, PostgreSQL service containers: https://docs.github.com/en/actions/use-cases-and-examples/using-containerized-services/creating-postgresql-service-containers
- GitHub Actions docs, workflow syntax (`needs`, `if`): https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- `cypress-io/github-action` README (`start`, `wait-on`): https://github.com/cypress-io/github-action
- `ruby/setup-ruby` README (`bundler-cache`): https://github.com/ruby/setup-ruby
