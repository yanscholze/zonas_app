# Workout accuracy and restored individual pace settings

## Confirmed causes

Tracked in [issue #24](https://github.com/yanscholze/zonas_app/issues/24), with
individual-zone persistence history in [issue #22](https://github.com/yanscholze/zonas_app/issues/22).

The previous accuracy deducted a pace deviation as a percentage of the pace
boundary, then averaged it with correct volume. A workout outside its pace band
could therefore receive 99%. Unmapped stages were excluded; a correct warmup
could conceal incorrect main work. Mean pace also hides alternating fast/slow
running. Production examples with 99% were reproduced from retained raw samples.

## Accuracy policy

- A single total-volume allowance is **300 seconds or 100 metres**, confirmed
  by Yan. Absolute stage deviations share that allowance; each repetition does
  not receive a separate allowance. Signed deviations cannot cancel each other.
- Only prescribed units are evaluated. A session's estimated kilometres are not
  a distance target for time-based stages.
- Pace uses the prescribed band with a **3 s/km** GPS margin. Full Garmin detail
  samples determine measured time inside that band. The SI speed values are used
  directly; `descriptor.unit.factor` is display metadata.
- Pace, volume and identified-stage coverage combine multiplicatively. The main
  work's pace is a limiting criterion, so correct warmup or volume cannot conceal
  incorrect main effort.
- Missing stages reduce coverage. Missing numerical target ranges produce
  insufficient-data status; volume alone cannot establish zone compliance.
- If only stage averages are available, the UI labels the evaluation as an
  estimate. Volume-only results are labeled as volume. Missing data is shown as
  unavailable rather than a measured training failure.
- Results show measured time in the prescribed pace zone per stage. Connect's
  original heart-rate-zone totals remain separate and do not substitute for pace.

The active timer aligns retained speed samples with the original identified lap
windows. Paused time does not create active running seconds; gaps over 30 seconds
are not interpolated. Original targets, lap associations, activity metrics,
reviews, conversations and scheduling are preserved. Mapping version 4 adds pace
evidence; older linked results can be refreshed without repeatedly refetching
unrelated activities.

## Individual-zone recovery and protection

A full private D1 export was saved before production changes and imported into
a private local SQLite copy. The commit boundary is `8e9f84e`, dated
2026-11-05 16:50:18 UTC. The 22 source evaluations retained their saved zone JSON;
historical sent-workout targets examined agreed with those values. The deleted
client lookup contained three demonstration athletes and is not recovery data.

The recovery selects the latest approved, complete individual set before that
boundary, falling back to a later approved set only where no earlier set exists.
There are **15 recoverable sets**: 14 before the boundary and one later set.
No pace or zone is calculated for recovery. The user accepted leaving the one
athlete without recoverable numerical ranges pending.

`athlete_pace_zones` stores each explicit individual configuration and its source
test/origin. Precedence is individual configuration → approved evaluation → coach
defaults. Creating/calculating a new test does not overwrite it. Explicitly
approving reviewed ranges updates it; the five-minute protocol never generates
zones. Existing approved source evaluations remain unchanged by recovery.

Teachers can edit **Cadastro manual de zonas individuais** independently of a
test. Students missing individual ranges receive an actionable alert in the
teacher's athlete list. New-student onboarding requests those ranges, and the
alert clears after a manual save or approved review. Coach defaults do not clear
the individual-zone alert. Backups and athlete deletion include the new table.

## Recovery tools and safety

Both tools default to dry-run and require a private local D1-export copy plus a
unique owner identity. Use Node 22 with `--experimental-strip-types`:

```sh
node --experimental-strip-types scripts/restore-individual-zones.mjs \
  --snapshot /private/recovery/before.sqlite --coach Jonas \
  --cutoff 2026-11-05T16:50:18Z
node --experimental-strip-types scripts/recalculate-workout-accuracy.mjs \
  --snapshot /private/recovery/before.sqlite --coach Jonas
```

Review the generated SQL and private JSON reports before repeating with
`--apply`. No recovery files, personal values or database exports belong in Git.
Restoration checks that the source still matches, skips existing individual
settings, and preserves concurrent manual edits. Recalculation guards original
import timestamps or manual metrics, and skips explicitly unperformed workouts.
It patches derived evidence/scores rather than replacing source activity data.
Use the private backup for a selective rollback if required; a full production
database rollback would also rewind unrelated user activity and is not part of
this workflow.

The local rehearsal restored 15 sets and verified all **131** selected execution
scores against the generated report, with zero mismatches. **106** scores changed
in the rehearsal. Production applied counts/guards are documented in the release
comments after execution.

## Validation and practical limits

Build and all **261 tests** passed. Coverage includes inside-band pace, 100%
outside-band samples with a misleading mean, incorrect main work, missing stages,
the shared 5-minute/100-metre allowance, manual-zone priority, portfolio isolation,
missing-zone alerts, manual edit/save/reload and preventing default auto-fill.
Changed-scope React Doctor reports no introduced findings (score 38); focused
ESLint passes. Full lint retains unrelated findings, and TypeScript retains its
six existing Cloudflare environment/type diagnostics.

`allowImportingTsExtensions` supports explicit TypeScript runtime imports for the
same shared modules in Node recovery tools and tests; the project uses no-emit
type checking and its existing bundler for releases.

The score is a technical adherence measure under this policy, not a medical or
physiological assessment. Partial imports and average-only providers cannot prove
second-by-second zone adherence. Physical watch execution remains outside these
local/API checks.
