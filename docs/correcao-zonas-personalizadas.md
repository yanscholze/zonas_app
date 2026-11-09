# Personalized pace-zone persistence and active-zone visibility

Tracked in [issue #22](https://github.com/yanscholze/zonas_app/issues/22).

## Report and evidence

The report said personalized zones appeared to revert to defaults, without a
specific athlete, screen or attempt. A read-only production D1 audit found 22
evaluations for 15 athletes in the relevant portfolio: 21 had five stored ranges;
the remaining evaluation was a zone-free five-minute test. No coach defaults were
configured. This does not establish which interaction caused the reported case.

Two reproducible defects were identified:

1. Saving an approved pace evaluation as a draft changed its status from
   `Aprovado` to `Rascunho revisado`. The active-zone resolver correctly excludes
   unapproved evaluations, so that action silently removed its ranges from use.
   Another approved evaluation or coach defaults could then become active.
2. The main tests page hid approved evaluations and continued displaying the
   calculator's provisional ranges. After custom approval there was no canonical
   active-zone display or entry point to reopen that evaluation on this page.

The profile editor also updated local fields directly from a write response;
duplicate-submission acknowledgements only contain `alreadySaved`, so they could
replace local ranges/status with missing values even though the database save
had succeeded.

## Changes and decisions

- Show **Zonas em uso nos treinos** using `trainingZones` returned by the API,
  including the individual/default origin. Reopen the active approved pace
  evaluation using **Editar ritmos individuais**.
- Both review entry points reread canonical evaluations and effective ranges
  after saving. A partial write acknowledgement is never treated as zone data.
- An already approved pace evaluation offers **Salvar e usar ritmos
  personalizados**. Draft saving is reserved for pending evaluations.
- Reject `review` on an approved pace evaluation with an actionable HTTP 409
  `approved_test_requires_approval` response. The SQL write condition also prevents
  a concurrent approval in another tab from being overwritten by an older draft.
- Retain the existing approval requirement: pending drafts cannot silently
  replace active zones. Reapproval still queues eligible Garmin updates through
  the existing refresh flow.
- Label the calculator as a simulation, distinguish save/read errors, retain
  typed values on failure, and reject invalid seconds such as `5:99`.
- Keep individual-over-coach-default precedence and all five-minute-test rules.
  No zone ranges, protocols, database schema or production athlete records are
  generated or rewritten by this release.

## Validation

- Build and all 251 tests passed, including the real Chrome review UI.
- The API regression test reproduced the pre-fix draft demotion, then verified
  custom values in coach/student reads, protected draft saves, reapproval and
  protection against a stale status read during concurrent approval.
- The browser test edits custom ranges, saves, reads canonical values back even
  after a duplicate acknowledgement, remounts/reopens the editor, verifies invalid
  input feedback, and saves a pending draft without replacing active ranges.
- Existing Garmin payload, refresh-queue, Zepp, ordering and five-minute tests
  remain covered by the complete suite.
- The new display and API client pass focused ESLint. The full project retains
  117 errors and 16 warnings; rule counts in changed React files match HEAD.
  Changed-scope React Doctor reports no introduced diagnostics (overall score 37).
- TypeScript retains its six existing Cloudflare environment/type diagnostics;
  changed UI files add no diagnostics.

## Usage and limits

Refresh the app, open **Testes e zonas**, select the athlete, and check **Zonas em
uso nos treinos**. Choose **Editar ritmos individuais**, adjust the ranges and
confirm **Salvar e usar ritmos personalizados**. The profile's review editor uses
the same explicit action for an approved evaluation.

The most recent approved pace evaluation still supplies active individual
ranges. Editing a historical evaluation does not supersede a newer evaluation.
Historical values already overwritten before this fix cannot be inferred from
the report. No automatic data repair is performed without known intended values.

No account reconnection or reinstall is required. Actual watch execution is not
asserted by the automated payload/API checks.
