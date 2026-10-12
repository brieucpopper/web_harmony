# Harmony Gen — Progress & Handoff

**Date:** 2026-10-13 · **State:** M0 + M1 shipped and verified, two bug-hunt
rounds done · **Next:** M2 (pitch-track + segment)
**Read with:** `prd.md` (spec, §1–§12 + Part B). This records what was built,
every deviation, and how pieces interact — enough for a second person to do M2.

## 1. Commands & gates

```bash
cd /home/brieuc/code/harmony-gen
npm run dev        # localhost:5173 (restart it if e2e fails impossibly — see §7)
npm test           # vitest: 45 passed
npm run lint       # eslint, must be silent
npm run build      # tsc -b + vite + PWA; bundle ~352 KB (~111 KB gzip, budget 2 MB)
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
  depth 50, tested). `finishIngest`/`restore`/`reset` clear undo + selection so
  history never leaks across projects.
- UI: Dropzone (picker + drag-drop, progress only while busy, error toast, mono
  banner), TopBar (file status, BPM 40–240, 24-key selector, Grid/Snap/Key
  toggles, transport, 10 Hz readout, disabled M6 buttons), Ruler (bar.beat +
  sec, click/arrow-key seek), Minimap (waveform, click-jump), ShortcutsHelp,
  Toast.
- `dsp/theory.ts` (forward from M4 for row highlight): `MAJOR/MINOR`,
  `pitchClass`, `scaleSet`, `isInScale`, `nearestInScale` (nearest, tie→down).
  M4/M5 snap reuses `nearestInScale`.

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

- **Ingest** (`Dropzone.ingest`): `beginDecode` → `decodeFile` → `monoToAudioBuffer`
  → `engine.loadBuffer` → `finishIngest`. **M2 hooks in at the `// M2 continues
  here` marker**: worker → `segmentFramesToChunks` → white `Voice` + `f0`.
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
`dsp/theory(.test)`, `audio/engine|webEngine`, `persist/idb`,
`store/projectStore|selectionStore|undo(.test)`, `editor/useZoomPan(.test)`,
`editor/PitchCanvas|Piano(.test)|Ruler|Minimap`,
`app/App|TopBar|VoiceTabs|Dropzone`, `ui/Toast|Modal|ShortcutsHelp`,
`public/piano/*.mp3`, configs, `e2e/smoke|ingest|view`.
Stubs (grep `lands in M`): `dsp/pitchTrack.worker` + `dsp/segment` → **M2**;
`editor/tools/{select,cut,move}` → M3; `audio/renderVoice.worker` → M4;
`modals/AdvancedEdit` + `ui/Slider` → M5; `audio/exportWav|exportMidi`,
`persist/fileSaveLoad` → M6.
Tests: `src/**/*.test.ts`, `e2e/*.spec.ts` (system Chrome, `--mute-audio`,
`reuseExistingServer`). QA fixtures in `/tmp/harmony-qa/` (regenerate with
python `wave` if `/tmp` is wiped) + T1–T20 checklist (chat, 2026-10-13).

## 6. M2 handoff

1. `npm i aubiojs pitchy` (lazy WASM; JS-YIN fallback).
2. `dsp/pitchTrack.worker.ts`: `{mono, sampleRate}` → per-frame
   `{f0Hz, conf, rmsDb}`, voiced if `conf ≥ 0.7 && rms ≥ −40 dB`, median-5 +
   Hampel, progress posts, cancellable. Range 50–1200 Hz.
3. `dsp/segment.ts` per PRD §6.2 (signature frozen): 80 ms min-note, 40 ms
   merges, 100-cent/50 ms splits, drop <60 ms, `baseMidi = round(median)`, keep
   `pristineCurve` + `origBaseMidi`.
4. Wire `Dropzone` at the M2 marker: decode → worker → chunks → white `Voice`
   (`VOICE_COLORS[0]`, `nanoid`) → store → autosave (`f0` rides along).
5. Verify: synthetic-curve split/merge tests; `vibrato.wav` (220 Hz + 5 Hz)
   shows wobble; <2 s per 60 s; breaths = gaps; extend `e2e/ingest.spec.ts`
   with a white-voice assertion if cheap.
6. Do **not** touch: engine clock, zoom store, autosave schema (additive only),
   canvas draw architecture.

## 7. Gotchas & backlog

- Stale HMR dev server can fail e2e impossibly — restart it. Kill precisely:
  `kill <pid>`, never `pkill -f vite`. Playwright reuses a running server.
- Backlog (not M2): waveform peak-cache at extreme zoom-out; dirty-flag
  rendering (battery); viewport-aware H-scroll max; default PWA icon; minimap
  viewport rect (M3); `body min-width: 1024px` desktop-first; no mobile touch
  editing (V1 out of scope).
