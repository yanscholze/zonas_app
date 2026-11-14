# Next race in the workout editor, multiple student races and workout chat

## Existing behavior and confirmed defects

`athlete_races` and the race API already supported multiple entries per athlete.
However, the student form sent `athleteName` to the student route, which rejects
that field with HTTP 400 `unexpected_field`. Student identity must come from the
session. This blocked valid race and personal-record submissions. The screen
also displayed just one race and retained the submitted fields. The header could
select an old race because it used the first row of the date-ascending history.
Tracked as [issue #23](https://github.com/yanscholze/zonas_app/issues/23).

The internal conversation already existed in `WorkoutChat`, with
`workout_messages` grouped by execution and authenticated student/coach routes.
Student replies already reopened the coach review and coach messages already
fed student notifications. This release improves access and delivery handling;
it does not introduce a separate global chat or replace the existing model.

## Changes

### Coach workout context

`NextRaceCard` appears when composing/editing an individual student's workout.
It displays the next race's name, date, distance, days remaining, location,
priority, analysis status and goal where available. It is omitted for global
base-template editing. Empty and retry states do not block workout editing.

The card reads the existing coach-scoped race endpoint. `shared/races.ts` selects
the nearest calendar date on or after today in Sao Paulo, includes today's race,
and excludes invalid, past and discarded races. Pending races remain visible
with their pending status; displaying a race does not approve it or change its
planning priority. The same selection is used in existing race summaries.

### Multiple student races

The student sends only allowed fields to the authenticated student endpoint.
After a successful save, the list is reloaded and the race form resets for the
next entry. `StudentRaceList` shows all races with dates, distances, locations,
goals and coach analysis status. Prior registrations remain available.

A repeated acknowledgement is handled by the common API client. A successful
save followed by a failed list refresh is reported as saved with a refresh
instruction, instead of suggesting that the student repeat the write. Failed
writes retain the entered values and show a clear error. The existing
same-athlete/name/date upsert behavior remains unchanged.

### Conversation on each workout

The current workout result exposes the conversation open for the student; recent
workouts with coach feedback expose it open as well. Other history entries have
an explicit **Responder ao treinador · Chat do treino** action. Coach reviews
retain their conversation access. Messages have author, timestamp and side-based
bubbles, with a labeled reply field.

Legacy coach feedback stays as the initial message. Failed sends retain drafts;
duplicate acknowledgements reload canonical messages. Pending background reads
cannot replace a successful send with stale history. The open conversation polls
every 15 seconds while the browser document is in the foreground. This is polling,
not WebSocket delivery. Trainer previews continue to require a real student
session before sending as the student.

No database migration, new protocol or production data rewrite is required.

## Validation

- Build and all 255 tests passed, with no skipped browser tests on this machine.
- API checks persist two student races, update one without losing the other,
  verify records, reject invalid dates/injected identity fields, and verify
  student/coach portfolio isolation. Existing bidirectional chat authorization
  and review-reopening checks remain in the suite.
- Calendar tests cover today's race, past/discarded entries, unsorted input,
  UTC midnight in Sao Paulo, and month/year transitions.
- A real Chrome test exercises the student form, repeated registrations, form
  reset, failed-submit preservation, next-race card/retry/mobile width, student
  replies, coach history, failed sends, duplicate acknowledgements, stale reads
  and restricted trainer previews.
- Changed-scope React Doctor reports no introduced findings (score 38). New and
  changed standalone components pass focused ESLint. Full lint and TypeScript
  retain unrelated baseline findings, including the six Cloudflare type errors.

## Usage

Coach: open a student's workout editor to see **Próxima prova** near the top.

Student: open **Mais → Provas e recordes**, submit a race, then fill in the cleared
form for another race. All registrations appear under **Minhas provas**.

Conversation: open a completed workout/result and use **Sua resposta ao
treinador**. Messages remain attached to that workout's execution. The coach can
reply from the workout review. Refresh the browser/PWA to load the new interface;
no reinstall or integration reconnection is necessary.

Production-account interaction, physical phone browsers and watch execution are
not asserted by the automated local browser/API tests. This release does not
change Garmin/Zepp workout conversion.
