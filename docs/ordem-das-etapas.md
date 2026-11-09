# Editable workout stage order

## Cause

The editor kept warmup, cooldown, repeats and additional steps in separate states.
Saving concatenated these categories in a fixed order. Reopening an interleaved
session changed its sequence; duplicate warmup/cooldown labels were discarded.
Written-workout conversion also grouped steps rather than retaining their order.
Tracked as [issue #21](https://github.com/yanscholze/zonas_app/issues/21).

## Changes and decisions

- Keep a single ordered editor array. `shared/workout-editor.ts` reads and writes
  the existing `StructuredSession.steps` format; no database migration is needed.
- Labels do not determine position or identity. Warmup/cooldown are editable
  simple steps and can occur multiple times anywhere in the sequence.
- Move stages using up/down buttons or the position selector. These controls
  support touch and keyboard operation without requiring a dragging gesture.
- Duplicate, remove and rename steps, including repeat groups. A workout needs
  at least one step; no particular stage category is mandatory.
- Keep each repeat group's effort/recovery pair together. Moving a group does
  not change its repetition count or internal execution semantics.
- Preserve seconds/minutes/meters/kilometers for simple steps, exact saved meter
  distances, walking and zero recovery when reopening an existing repeat.
- Keep `Livre` as `zone: null`; pace approval and coach defaults remain unchanged.
- Use the same array for the preview, serialization and reopening. Text conversion
  now retains interleaving and correctly recognizes explicit cooldown labels.
- Match mobile footer margins to the drawer padding to prevent horizontal overflow.

The student card, backend resolver, Garmin converter and Zepp device endpoint
already consume array order. They require no production logic change. Garmin's
continuous step numbering, nested repeat steps and targets remain intact.

## Validation

- `npm test`: build and all 249 tests passed, with no skips on this machine.
- Pure round-trip tests cover mixed stages, duplicate labels, exact distances,
  free targets, zero recovery and moving stages across repeat groups.
- A real headless Chrome test exercises the actual editor component at a mobile
  breakpoint: edit, move, duplicate, remove, save, reopen, preview, text conversion,
  empty-workout protection and a single optional stage.
- The API test saves the editor output through the workout endpoint, verifies
  stored JSON, inspects the outgoing Garmin payload using a mocked Connect
  transport, and checks the authenticated Zepp device response.
- Changed-scope React Doctor: score 38, no introduced findings. The new shared
  module passes ESLint. Full lint still reports 117 existing errors and 16
  warnings; the changed client has nine fewer `no-explicit-any` findings and no
  additional rule counts versus HEAD.
- The TypeScript check retains the existing six Cloudflare environment/type
  diagnostics; neither changed implementation file adds a diagnostic.

## Usage and limits

Open the workout editor, choose a position beside each stage, then update the
workout and save/release its week through the existing flow. Existing weeks are
not rewritten by deployment. Previously lost stages cannot be reconstructed
automatically; the coach must add them again if needed.

No reinstall or account reconnection is required. Refresh the browser/PWA to load
the editor. Physical Garmin/Amazfit watch execution remains a manual check; the
automated integration checks verify order at the payload/API boundary.
