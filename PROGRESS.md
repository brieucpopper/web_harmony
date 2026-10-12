# Harmony Gen — Progress & Handoff

**Date:** 2026-10-13 · **State:** M0 + M1 shipped and verified · **Next:** M2 (pitch-track + segment)
**Read with:** `prd.md` (spec, §1–§12 + Part B). This file records what was actually
built, every deviation from the PRD, and how the pieces interact — written so a
second person can implement M2 without archaeology.

## 1. Commands & gates

```bash
cd /home/brieuc/code/harmony-gen
npm run dev        # localhost:5173 (dev server runs in background; restart it if e2e acts bizarre — see §7)
npm test           # vitest: 41 passed
npm run lint       # eslint, must be silent
npm run build      # tsc -b + vite + PWA; bundle ~343 KB (108 KB gzip, budget 2 MB)
npx playwright test  # 7 passed, system Chrome (see playwright.config.ts)
```

All four gates are green as of this writing. Do not start M2 with a red gate.

## 2. Stack (deviations from PRD §7 are deliberate)

PRD says Vite 5 / React 18 / Tailwind 3. The scaffold installed current stable and we
kept it: **Vite 8, React 19, Tailwind 4** (via `@tailwindcss/vite`, theme in
`src/index.css` `@theme`), **TypeScript ~6.0**, Zustand 5, Dexie 4, nanoid 6,
Vitest 5 + jsdom, Playwright 1.64, `vite-plugin-pwa` 2, ESLint 10 with
`typescript-eslint` `strictTypeChecked`. No backend, no other runtime deps.
M2 must `npm i aubiojs pitchy` (lazy); M4 adds `rubberband-wasm soundtouchjs @tonejs/midi`.

TS is `strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes` and lint
additionally enforces `no-explicit-any`, `consistent-type-imports`, and
`restrict-template-expressions` with **`allowNumber: true`** (time/pitch readouts
interpolate numbers constantly). Rules that bite newcomers:

- `no-unnecessary-condition` + `noUncheckedIndexedAccess`: every `arr[i]` is
  `T | undefined` — **keep the guards** (including on `Float32Array` reads).
  The one exception is untrusted-IDB data (see §4, `restore`).
- `no-confusing-void-expression`: zustand setters must use braces
  (`setX: (v) => { set(...); }`), never shorthand.
- `exactOptionalPropertyTypes`: read possibly-stale flags with `!== false`
  (e.g. `project?.highlightKey !== false`), never `??` on required booleans.
- No `ArrayBuffer`-style shenanigans in tests: `validateFileMeta` is tested with
  `{ name, size } as File`, no 21 MB allocations.

## 3. What was built

### M0 — scaffold + empty piano-roll shell
- Full `src/` tree per PRD §8. Unimplemented milestones are **compile-safe stubs**
  (export a `*_MILESTONE` const or throw `lands in M<n>`) — grep `lands in M` to
  find every seam.
- `constants.ts`: A440, C2–C6 axis math (`midiToY`/`secToX` + inverses),
  12-TET converters, palette, ingest limits, **zoom ranges 5–600 px/sec and
  4–96 px/semitone** (widened twice per user feedback; PRD FR3.2 amended).
  NOTE: `NOTE_COUNT` is **49** (36–84 inclusive). PRD's "48 notes" means semitone
  steps; the formula `MIDI_C6 - MIDI_C2 + 1` is authoritative.
- Layout: `TopBar | VoiceTabs | Dropzone | (Piano | (Ruler + Canvas) | VScroll) |
  BottomBar`, dark theme, DPR-scaled single canvas, 2 hardcoded DEMO chunks
  (visible only with no project).
- `Piano.tsx` also ships `previewSine()` (M2 keeps it).

### M1 — ingest + transport + persist skeleton
- `dsp/audioUtil.ts`: ext/size/empty validation (`IngestError` with `code`),
  `decodeAudioData` → stereo→mono average (`mixToMono`, pure + tested),
  duration check **after** decode. Cancel via `AbortController` (standard
  primitive — a hand-rolled ref flag tripped `no-unnecessary-condition`).
- `audio/engine.ts` (interface) + `webEngine.ts` (singleton via `getEngine()`):
  one clock, `loadBuffer/play/pause/stop/seek`, loop-all wrap, master volume
  0–1.5. Playback-end resets to 0 so Play restarts (Stop semantics).
- `persist/idb.ts`: Dexie `harmony-db` v1 (`projects`, `audioBlobs`),
  `AUTOSAVE_*` ids, 1 s debounce in the store (module-level timer, cleared on
  re-schedule). Reload restores project + rebuilds the `AudioBuffer` from stored
  mono; corrupt `version !== 1` keeps the current project (NFR4). `beforeunload`
  guard while dirty.
- `store/projectStore.ts` (project/audio/status/progress/transport mirror),
  `selectionStore.ts` (tool + ids, M3 fills behavior), `undo.ts`
  (`structuredClone` voice snapshots, depth 50, tested).
- UI: Dropzone (picker + drag-drop, progress, blocking error toast, mono banner),
  TopBar (file status, BPM 40–240 clamped, 24-key selector, Grid/Snap/**Key**
  toggles, transport, live 10 Hz time readout, disabled M6 Save/Load/WAV/MIDI),
  Ruler (bar.beat + sec, click/arrow-key seek), Minimap (waveform, click-jump),
  ShortcutsHelp (`?` button + `?` key, Esc/backdrop close), Toast.
- `dsp/theory.ts` (pulled forward from M4 for the row highlight): `MAJOR/MINOR`
  sets, `pitchClass`, `scaleSet`, `isInScale`, `nearestInScale` (nearest,
  tie→down) — all unit-tested. M4/M5 snap reuses `nearestInScale` as-is.

### Post-M1 user-feedback rounds (all in `prd.md` amendment + code)
1. **Viewport gestures**: wheel = V-zoom to cursor, Ctrl/⌘+wheel = H-zoom to
   cursor, Shift+wheel = H-pan, middle-drag = grab-pan, Ctrl+0/+/− = reset/in/out.
   Canvas consumes wheel events non-passively → **browser page-zoom locked at 100%**.
   `routeWheel` is pure + unit-tested; `zoomHAt/zoomVAt` keep cursor content stable.
2. **Zoom controls**: labeled H −/+ and V −/+ groups + `100%` reset (the old
   identical ± pairs were confusion, not a bug).
3. **Scrollbars**: the "broken blur slider" was the native-styled H-scroll with an
   empty range — now dark-themed, disabled until audio loads. V-scroll is a custom
   deterministic slider (native vertical ranges map min→bottom). Piano/canvas rows
   were 28 px misaligned (piano spanned the ruler) — piano now shares the canvas
   row; **ruler lives in the canvas column** so playhead line and triangle marker
   share the exact x-map (regression-tested to ≤1 px).
4. **Bugs fixed**: middle-drag died after one move (drag origin in a torn-down
   effect closure → moved to a ref); zoom/scroll choppiness (canvas + ruler loops
   are now **mount-once**, reading stores via `getState()` per frame — zero React
   re-renders on ticks); piano keys memoized; ruler second/bar labels density-gated.
5. **Key highlight** (this round): out-of-key rows dimmed to ~45% via header-bg
   overlay (set built once per frame), piano keys subtly greyed out-of-key, `Key`
   toggle next to Grid/Snap (default ON, persisted, pre-toggle autosaves normalize
   to ON in `restore`). New `Project.highlightKey` field — PRD §5 + FR7.1 updated.

## 4. How components interact (data flows)

- **Ingest** (`Dropzone.ingest`): `beginDecode` → `decodeFile` (progress cb,
  checks `signal.aborted`) → `engine.getContext()` → `monoToAudioBuffer` →
  `engine.loadBuffer` → `finishIngest` (builds `emptyProject`, schedules
  autosave). **M2 hooks in at the `// M2 continues here` marker**: post mono to
  `pitchTrack.worker`, `reportProgress('Analyzing…')`, `segmentFramesToChunks` →
  set `project.voices = [white]` + `project.f0`, keep everything else identical.
- **Transport**: UI calls the engine (the clock); engine `onStateChange` mirrors
  `playing` + pause/seek/end positions into the store; TopBar polls
  `getPlayhead()` at 10 Hz for the live readout; canvas/ruler read the engine
  directly every frame. Never store playhead per-frame in zustand.
- **Viewport**: `useZoomPan` is the single source (`pxPerSec/pxPerNote/scrollX/
  scrollY`). Canvas/ruler subscribe to nothing; BottomBar/VScroll/Piano subscribe
  narrowly. `setScroll` clamps ≥ 0 only; VScroll clamps its own upper bound.
- **Persist**: every project mutation spreads a new `project`, calls
  `scheduleAutosave` (1 s), sets `dirty: true`. Restore path normalizes untrusted
  IDB data (`Partial<Project>` cast + `?? true` defaults) — the only place
  `??`-on-required-field is acceptable; add a comment when you do it.
- **Canvas chunk rendering is already voice-generic** (fill/border from
  `voice.color`, selection ring, orange curve polyline): M2's white voice renders
  with zero canvas changes. `VoiceTabs` switches from its M2 placeholder to real
  tabs automatically once `voices.length > 0`.

## 5. File inventory (status → milestone)

Done: `constants(.test)`, `types`, `flags`, `dsp/audioUtil(.test)`,
`dsp/theory(.test)`, `audio/engine`, `audio/webEngine`, `persist/idb`,
`store/projectStore|selectionStore|undo(.test)`, `editor/useZoomPan(.test)`,
`editor/PitchCanvas|Piano|Ruler|Minimap`, `app/App|TopBar|VoiceTabs|Dropzone`,
`ui/Toast|Modal|ShortcutsHelp`, `index.css`, `main.tsx`, `vite/playwright/eslint/
prettier` configs, `e2e/smoke|ingest|view`.
Stubs (grep `lands in M`): `dsp/pitchTrack.worker` + `dsp/segment` → **M2**;
`editor/tools/{select,cut,move}` → M3; `audio/renderVoice.worker` → M4;
`modals/AdvancedEdit` + `ui/Slider` → M5; `audio/exportWav|exportMidi`,
`persist/fileSaveLoad` → M6. `ui/Modal` + `ShortcutsHelp` shipped early.
Tests: `src/**/*.test.ts` (vitest+jsdom), `e2e/*.spec.ts` (Playwright, system
Chrome `channel: 'chrome'`, `--mute-audio`, `reuseExistingServer`).
QA fixtures: `/tmp/harmony-qa/` (stereo mix, silence, 0.2 s blip, 130 s duration
trap, 23 MB size trap, fake.mp3, bad-ext .ogg, 10 s baseline) + T1–T20 manual
checklist (chat, 2026-10-13) — regenerate with python `wave` if `/tmp` is wiped.

## 6. M2 handoff (concrete steps)

1. `npm i aubiojs pitchy` (lazy-import the WASM; JS-YIN fallback on failure).
2. Implement `dsp/pitchTrack.worker.ts`: input `{mono, sampleRate}`, YIN
   1024/441 @44.1k, per-frame `{f0Hz, conf, rmsDb}`, voiced if `conf ≥ 0.7 &&
   rms ≥ −40 dB`, median-5 + Hampel, progress posts, cancellable. Range 50–1200 Hz.
3. Implement `dsp/segment.ts` per PRD §6.2 (signature frozen; throw until done):
   80 ms min-note, 40 ms merges, 100-cent/50 ms splits, drop <60 ms,
   `baseMidi = round(median)`, keep `pristineCurve` + `origBaseMidi` copies.
4. Wire `Dropzone` at the M2 marker: decode → worker → chunks → white `Voice`
   (`VOICE_COLORS[0]`, `nanoid` id) → store → autosave (f0 cache rides in
   `project.f0`, already persisted/restored). Keep engine buffer = original mono.
5. Verify: synthetic-curve unit tests for splits/merges; generate
   `vibrato.wav` (220 Hz + 5 Hz wobble) and eyeball the orange curve; analysis
   <2 s per 60 s audio; breaths = gaps. Extend `e2e/ingest.spec.ts` with a white-
   voice assertion (canvas draws `voice.color` blocks — assert via store? expose
   nothing; assert chunk count through a `data-` attribute only if cheap).
6. Do **not** touch: engine clock, zoom store, autosave schema (additive only),
   canvas draw architecture (add curve/voice branches inside existing hooks).

## 7. Gotchas & polish backlog

- **Restart the dev server if e2e fails impossibly** (a real incident: a days-old
  HMR process served inconsistent store modules; fresh server → 8/8 green).
  Kill precisely: `kill <pid>` from the startup echo — never `pkill -f vite`
  (matches its own shell). Playwright reuses a running server; CI spawns its own.
- Playwright `uncheck()` on controlled checkboxes is fine on a fresh server.
- Polish backlog (not M2): waveform peak-cache at extreme zoom-out; idle RAF →
  dirty-flag rendering (battery); H-scroll max is duration-based, not
  viewport-aware; README is still Vite-default (M6); PWA icon is default;
  minimap has no viewport rect (M3); `body min-width: 1024px` (desktop-first per
  NFR3); no mobile touch editing (V1 out of scope).
