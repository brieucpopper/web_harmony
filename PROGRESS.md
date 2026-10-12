# Harmony Gen — Progress & Handoff

**Date:** 2026-10-13 · **State:** M0 + M1 + M2 shipped and verified · **Next:** M3 (core editor)
**Read with:** `prd.md` (spec, §1–§12 + Part B). This records what was built,
every deviation, and how pieces interact — enough for a second person to do M3.

## 1. Commands & gates

```bash
cd /home/brieuc/code/harmony-gen
npm run dev        # localhost:5173 (restart it if e2e fails impossibly — see §7)
npm test           # vitest: 63 passed
npm run lint       # eslint, must be silent
npm run build      # tsc -b + vite + PWA; main ~361 KB (~114 KB gzip) + pitch worker ~195 KB, budget 2 MB
npx playwright test  # 7 passed, system Chrome (see playwright.config.ts)
```

All gates green. Do not start M2 with a red gate.

## 2. Stack (deviations from PRD §7 are deliberate)

PRD says Vite 5 / React 18 / Tailwind 3; scaffold installed current stable and we
kept it: **Vite 8, React 19, Tailwind 4** (via `@tailwindcss/vite`),
**TypeScript ~6.0**, Zustand 5, Dexie 4, nanoid 6, Vitest 5 + jsdom, Playwright
1.64, `vite-plugin-pwa` 2, ESLint 10 `strictTypeChecked`. No backend.
M2 adds `aubiojs pitchy` (lazy); M4 adds `rubberband-wasm soundtouchjs @tonejs/midi`.

TS is `strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes`; lint adds
`no-explicit-any`, `consistent-type-imports`, `restrict-template-expressions`
(`allowNumber: true`). Rules that bite:

- `no-unnecessary-condition` + `noUncheckedIndexedAccess`: every `arr[i]` is
  `T | undefined` — **keep the guards** (incl. `Float32Array` reads). Exception:
  untrusted-IDB data in `restore` (see §4).
- `no-confusing-void-expression`: zustand setters use braces, never shorthand.
- `exactOptionalPropertyTypes`: read possibly-stale flags with `!== false`,
  never `??` on required booleans.
- `no-useless-assignment`: declare `let worker: Worker | null` without
  initializer when both branches assign.
- Untyped deps need ambient declarations: `dsp/aubiojs.d.ts` types the WASM
  surface (else `no-unsafe-*` fires on the dynamic import).
- No fat allocations in tests: `validateFileMeta` is tested with
  `{ name, size } as File`.

## 3. What was built

### M0 — scaffold + empty piano-roll shell
- Full `src/` tree per PRD §8. Unimplemented milestones are **compile-safe
  stubs** — grep `lands in M` for every seam.
- `constants.ts`: A440, C2–C6 axis math (`midiToY`/`secToX` + inverses), 12-TET,
  palette, ingest limits, **zoom 5–600 px/sec, 4–96 px/semitone** (widened per
  user feedback; PRD FR3.2 amended). `NOTE_COUNT` is **49** (36–84 inclusive);
  PRD's "48" means semitone steps.
- Layout: `TopBar | VoiceTabs | Dropzone | (corner + Ruler) + (Piano | Canvas |
  VScroll) | BottomBar`. Dark theme, DPR-scaled single canvas, 2 hardcoded DEMO
  chunks (visible only with no project).
- `Piano.tsx` ships sampled click preview (`previewPiano`, sine fallback) from
  `public/piano/*.mp3` (fuhton/piano-mp3, MIT — see `LICENSE.txt` there).

### M1 — ingest + transport + persist skeleton
- `dsp/audioUtil.ts`: ext/size/empty validation (`IngestError`), decode →
  stereo→mono average (`mixToMono`, pure + tested), duration check after decode,
  cancel via `AbortController`.
- `audio/engine.ts` (interface) + `webEngine.ts` (singleton): one clock,
  `loadBuffer/play/pause/stop/seek`, loop-all wrap, master volume 0–1.5.
  Playback-end resets to 0 (Stop semantics).
- `persist/idb.ts`: Dexie `harmony-db` v1, 1 s debounced autosave. Reload
  rebuilds the `AudioBuffer` from stored mono; `version !== 1` keeps current
  (NFR4). `beforeunload` guard while dirty.
- `store/projectStore|selectionStore|undo` (snapshots via `structuredClone`,
  depth 50, tested). `finishIngest`/`finishAnalysis`/`restore`/`reset` clear
  undo + selection so history never leaks across projects.
- UI: Dropzone (picker + drag-drop, progress only while busy, error toast, mono
  banner), TopBar (file status, BPM 40–240, 24-key selector, Grid/Snap/Key
  toggles, transport, 10 Hz readout, disabled M6 buttons), Ruler (bar.beat +
  sec, click/arrow-key seek), Minimap (waveform, click-jump), ShortcutsHelp,
  Toast.
- `dsp/theory.ts` (forward from M4 for row highlight): `MAJOR/MINOR`,
  `pitchClass`, `scaleSet`, `isInScale`, `nearestInScale` (nearest, tie→down).
  M4/M5 snap reuses `nearestInScale`.

### M2 — pitch-track + segment (white voice)
- `dsp/pitch.ts` (pure, tested): `hopSamples`, `frameRmsDb` (silence floors
  −90 dB), `median`, `postProcessFrames` — 50–1200 Hz gate, voiced if
  `conf ≥ 0.7 && rms ≥ −40 dB`, MIDI convert, median-5 over voiced neighbours,
  Hampel single-frame >200c reject. Vibrato survives; lone octave blips don't.
- `dsp/pitchTrack.worker.ts` (Vite worker): `{start, mono, sampleRate}` in,
  `progress`/`done`/`error` posts out, `cancel` flag checked per frame.
  **`yinfast`** (spectral YIN — same family, ~3× faster than time-domain
  `yin` at identical accuracy; `yin` misses the <2 s/60 s budget at ~2.1 s,
  `yinfast` does 60 s in ~0.7 s). pitchy-MPM fallback if WASM fails to load.
  `dsp/aubiojs.d.ts` ambient types (the package ships untyped).
- `dsp/pitchTrack.ts`: `trackPitch` (worker + progress + AbortSignal; falls
  back to `trackPitchSync` when workers are blocked) and exported
  `trackPitchSync` (main-thread pitchy, chunked with yields — also the
  Vitest/jsdom path).
- `dsp/segment.ts` (pure, tested): voiced runs (min 80 ms) → dual-detector
  splits (exact semitone edges with ≥5-frame sustain on both sides, clustered
  with a median-window scan for transient-blurred jumps; step lands on the
  exact frame, ±10 ms) → merge gaps <40 ms when sides agree ±50c → drop
  <60 ms. Curve keeps the natural trajectory (+lerped micro-gaps),
  `baseMidi = clamp(round(median))`, `origBaseMidi`/`pristineCurve`/`fineCents`
  bookkeeping for M4/M5.
- Wiring (`Dropzone` at the old M2 marker): decode → `beginAnalysis` →
  worker (`Analyzing pitch x%…`, 0.8–0.92) → `beginSegmenting` → white Voice
  (`Voice 1`, `VOICE_COLORS[0]`, `nanoid`) → `finishAnalysis` (f0 cache rides
  along in autosave — reload skips re-analysis, asserted in e2e). Analysis
  failure degrades to the M1 shell (audio playable) + blocking toast, never a
  dead app. No abort checkpoint between resolve and finish: segmentation is
  synchronous, so a late abort is a no-op by design (never a stuck state).
- Canvas/Piano needed **zero** changes (voice-generic draw already).
  `VoiceTabs` gained `data-testid="voice-tabs"` for the e2e white-voice +
  reload assertions.
- Verified: 63 unit tests (incl. `chain.test.ts`: synth vibrato → 1 chunk at
  A3 with wobble intact; breaths → 2 chunks, no ghost notes); `vibrato.wav`
  (220 Hz + 5 Hz, ±5 Hz dev) uploads to one wobbling white chunk (screenshot
  `/tmp/vibrato-shot.png`); 60 s analysis 0.68 s.

### Post-M2 tweak — Wave toggle
- `Project.showWaveform` (default ON, persisted, old autosaves default ON in
  `restore`): TopBar `Wave` checkbox (disabled with no project) hides the main
  piano-roll waveform preview in `PitchCanvas`. Minimap overview always shows
  the waveform (navigation, not clutter). E2E covers flip + reload persistence.

### Post-M1 feedback + bug-hunt rounds
- **Gestures**: wheel = V-zoom to cursor, Ctrl/⌘+wheel = H-zoom, Shift+wheel =
  H-pan, middle-drag = pan, Ctrl+0/+/− = reset/in/out. Canvas consumes wheel
  non-passively → browser page-zoom locked at 100%. `routeWheel` pure + tested.
- **Alignment**: piano once spanned the ruler (28 px off) — header row now holds
  a dead corner cell so piano keys sit flush with canvas rows. Row top =
  `midiToY(midi)`, pitch lines at row center (`+ppN/2`); chunk fill matches its
  piano key exactly.
- **Perf**: `drawChunk` hoisted out of the RAF callback; canvas + ruler loops
  pause on `visibilitychange`; loops are mount-once, reading stores via
  `getState()` (zero React re-renders on ticks).
- **Keyboard**: global handler ignores `INPUT/SELECT/TEXTAREA/BUTTON` (no
  Space double-toggle) and `Arrow*` from `CANVAS` (ruler owns seek;
  ruler/VScroll `stopPropagation()`).
- **Key highlight** (default ON, persisted): out-of-key rows dimmed ~45%;
  piano collapses to 2 colors (white = in key, gray = out). New
  `Project.highlightKey` — PRD §5 + FR7.1 updated.

## 4. Data flows

- **Ingest** (`Dropzone.ingest`): `beginDecode` → `decodeFile` →
  `beginAnalysis` → `trackPitch` (worker) → `beginSegmenting` →
  `segmentFramesToChunks` → `finishAnalysis` (white `Voice` + `f0`) →
  `monoToAudioBuffer` → `engine.loadBuffer`. Analysis failure degrades to
  `finishIngest` (M1 shell) + blocking toast.
- **Transport**: UI calls the engine (the clock); engine `onStateChange` mirrors
  into the store; TopBar polls at 10 Hz; canvas/ruler read the engine per frame.
  Never store playhead per-frame in zustand.
- **Viewport**: `useZoomPan` is the single source. Canvas/ruler subscribe to
  nothing; BottomBar/VScroll/Piano subscribe narrowly. `setScroll` clamps ≥ 0;
  VScroll clamps its upper bound.
- **Persist**: mutations spread a new `project`, `scheduleAutosave` (1 s), set
  `dirty: true`. `restore` normalizes untrusted IDB data (`Partial<Project>` +
  defaults) — the only sanctioned `??`-on-required-field.
- **Canvas is voice-generic** (fill/border from `voice.color`, selection ring,
  orange curve): M2's white voice renders with zero canvas changes. `VoiceTabs`
  flips to real tabs once `voices.length > 0`.

## 5. File inventory

Done: `constants(.test)`, `types`, `flags`, `dsp/audioUtil(.test)`,
`dsp/theory(.test)`, `dsp/pitch(.test)` + `dsp/pitchTrack(.worker)` +
`dsp/segment(.test)` + `dsp/chain(.test)` + `dsp/aubiojs.d.ts`,
`audio/engine|webEngine`, `persist/idb`,
`store/projectStore|selectionStore|undo(.test)`, `editor/useZoomPan(.test)`,
`editor/PitchCanvas|Piano(.test)|Ruler|Minimap`,
`app/App|TopBar|VoiceTabs|Dropzone`, `ui/Toast|Modal|ShortcutsHelp`,
`public/piano/*.mp3`, configs, `e2e/smoke|ingest|view`.
Stubs (grep `lands in M`): `editor/tools/{select,cut,move}` → **M3**;
`audio/renderVoice.worker` → M4; `modals/AdvancedEdit` + `ui/Slider` → M5;
`audio/exportWav|exportMidi`, `persist/fileSaveLoad` → M6.
Tests: `src/**/*.test.ts`, `e2e/*.spec.ts` (system Chrome, `--mute-audio`,
`reuseExistingServer`). QA fixtures in `/tmp/harmony-qa/` (incl. new
`vibrato.wav`: 3 s 220 Hz + 5 Hz/±5 Hz; regenerate with python `wave` if
`/tmp` is wiped) + T1–T20 checklist (chat, 2026-10-13).

## 6. M3 handoff (M2 items all done — kept as the acceptance record)

1. ~~`npm i aubiojs pitchy`~~ done (lazy via dynamic import, worker + fallback).
2. ~~Worker~~ done (`yinfast` + pitchy fallback, progress, cancel-via-terminate).
3. ~~`segment.ts`~~ done (exact-edge + median-window splits, merges, drops).
4. ~~Wire `Dropzone`~~ done (`beginAnalysis`/`beginSegmenting`/`finishAnalysis`).
5. ~~Verify~~ done: 63 unit, vibrato wobble screenshot, 0.68 s/60 s, breaths =
   gaps, e2e white-voice + reload assertions.
6. Untouched as required: engine clock, zoom store, autosave schema (no version
   bump — `f0`/`voices` already in `Project`), canvas draw architecture.

M3 entry: `editor/tools/{select,cut,move}` stubs + `useZoomPan` (single
source) + `selectionStore`/`undo` + `drawChunk` ghost pattern in
`PitchCanvas`. Ruler + playhead RAF already live.

## 7. Gotchas & backlog

- Stale HMR dev server can fail e2e impossibly — restart it. Kill precisely:
  `kill <pid>`, never `pkill -f vite`. Playwright reuses a running server.
- Build warns `Module "path"/"fs" externalized, imported by aubiojs/build/aubio.js`
  (the package's CJS entry references node builtins). Benign: those branches
  only run under Node; the Chrome worker path is e2e-verified. Revisit only if
  aubio is ever imported on the main thread.
- Backlog (not M3): waveform peak-cache at extreme zoom-out; dirty-flag
  rendering (battery); viewport-aware H-scroll max; default PWA icon; minimap
  viewport rect (M3); `body min-width: 1024px` desktop-first; no mobile touch
  editing (V1 out of scope).
