# Harmony Generator — PRD + Implementation Plan
**Version:** 1.0-locked
**Date:** 2026-10-12
**Status:** Agreed from interview batches 1-3. Ready to build.
**Amendment 2026-10-13:** wheel = V-zoom, Ctrl/⌘+wheel = H-zoom, Shift+wheel = H-pan, middle-drag = pan, Ctrl+0/+/− = zoom in/out/reset (page-zoom locked 100%). Zoom 5–600 px/sec, 4–96 px/semitone.
**Goal:** Web-based vocal harmony generator like FL Newtone (see reference screenshot).

Reference image behavior: white blobs = original voice chunks, orange line = measured pitch curve f0(t), piano keyboard left = pitch axis, horizontal = time, playhead vertical line, dark theme.

---

# PART A — PRD

## 1. Overview & Product Definition

### 1.1 Vision
Upload a raw monophonic voice recording (MP3). App signal-processes it into a MIDI-like note sequence: continuous pitch curve `f0(t)` + auto-segmented note `chunks` (held notes). User edits chunks (move pitch/time, cut, delete), creates up to 5 parallel voices (color-coded, white=original + 4 harmonies), hears them as pitch-shifted copies of their own voice played simultaneously, exports mix + MIDI.

### 1.2 Locked decisions from interview
1. Harmony creation = **manual + one-click helpers + key snap/highlight**. Duplicate voice + transpose presets `+3/+4/+7/+12/-12`. Key selector (24 keys) tints in-scale rows, red border for out-of-key, `Snap to Key` button per voice/selection. No full AI auto-harmony in V1.
2. Harmony sound = **(a) pitch-shifted copy of actual voice**, preserves vibrato/formant, sounds like user. No synth-beep-only. No switchable synth in V1.
3. Move semantics = **(a) rigid**: orange curve moves with block, preserves vibrato/wobble. No auto-centering by default. Smart re-center available on demand in Advanced Edit.
4. Pitch engine = **client-side WASM, monophonic only, 10 ms hop, 50–1200 Hz, auto-ignore unvoiced/silence, median filter to MIDI**. 100% local, no server.
5. Input = **MP3+WAV, mono-mixdown, <20 MB, <120 s, analysis <2 s for 60 s**.
6. Playback/mix/export V1 = **WebAudio, per-voice mute/solo/volume, space + click-to-seek, export master WAV + MIDI**. No FX/reverb/pan/EQ.
7. Pitch move = **semitones only, A=440 fixed**, arrows ±1, Shift+arrows ±12. Advanced Edit modal on double-click: readout + Smart Re-center + Flatten 0–100% + Fine ±50c + Reset. Natural by default.
8. Time move = **free in ms + configurable BPM grid overlay** (visual + snap toggle). No time-stretch of audio in V1; move changes start, duration unchanged.
9. Selection = **click + Shift-click + marquee-drag + Esc clear**. Group move preserves relative offsets. Del deletes any voice chunk (undoable).
10. Cut/resize = **Cut tool (C/scissors, click to split, curve split) + Delete + right-edge trim/extend (silence)**. No merge, no left-edge stretch V1.
11. Key behavior = **24 keys (12 roots × major/minor), bright in-scale / dim out-of-scale, red border for non-scale chunks, Snap-to-Key transposes selected (or all) to nearest in-scale (nearest, tie-down). White default OFF, others manual button + optional Magnet toggle.**
12. Viewport = **C2–C6 vertical scroll, H-zoom 5–600 px/sec, V-zoom 4–96 px/semitone, piano 120 px fixed, click previews piano sample, ruler shows bar.beat + sec.**
13. Advanced modal V1 = **avg note + cents off + confidence + duration + Re-center + Flatten slider + Fine slider + Reset + Apply/Cancel + Undo**. No vibrato/gain/timing-quantize V1.
14. BPM = **40–240 default 120, 4/4 only, Show Grid + Snap-to-Grid toggles, thin beat / thick bar lines**. No auto-BPM, tap-tempo, offset, time-sig change V1.
15. Transport/mixer V1 = **Play/Pause (Space), Stop, click-seek, Loop-all toggle (full project), master volume. Per voice: color dot, M/S, volume 0–1.5, octave ±12 quick buttons, duplicate/delete. No pan, no region-loop V1.**
16. Persistence = **fully local, no login. Autosave IndexedDB (audio + edits) + Save/Load `.harmony.json`. Export master WAV + MIDI (1 track/voice). No MP3 export / cloud V1.**
17. Tech/perf = **Desktop-first Chrome/Edge, PWA offline, React+TS+Vite+Tailwind+Canvas + WebAudio + WASM DSP, no backend. Targets: analysis <2 s/60 s, drag <50 ms, 60 fps to 500 chunks, a11y >90.**
18. Out-of-scope V1 (architect for): AI auto-harmony, formant control, FX, polyphonic input, accounts/cloud, DAW plugin/VST, mobile touch editing.

### 1.3 Personas
- Singer-songwriter humming a melody, wants to hear 2–5 part harmony in own voice fast.
- Beginner: no theory, needs transpose presets + key highlight.
- Advanced: wants fine control, cut, re-center, flatten.

### 1.4 Core user stories
- US1: Upload MP3 → see curve + chunks in <2 s.
- US2: Drag chunk up +7 semitones → hear harmony fifth in own voice.
- US3: Duplicate white at +4, snap voice to C Major, fix 2 out-of-key notes.
- US4: Cut long note in two, move second half later, trim end.
- US5: Mute white, solo blue, loop playback, adjust volumes.
- US6: Double-click wobbly chunk → Smart Re-center → Flatten 30% → Apply.
- US7: Reload page → project restored. Export WAV for sharing + MIDI for DAW.

### 1.5 End-to-end workflow
`Upload → decode mono → pitch-track f0(t) → segment chunks → render white voice → display piano-roll → edit / duplicate voices → offline re-render shifted buffers → play/mix → save/export.`

---

## 2. Functional Requirements

### FR1 — Ingest
- FR1.1: Accept `.mp3,.wav` via picker + drag-drop. MIME validate.
- FR1.2: Decode with `AudioContext.decodeAudioData`. Stereo → mono average. Keep `originalBuffer` 44.1 kHz float32 mono. Keep original sampleRate for export.
- FR1.3: Limits: ≤20 MB, ≤120 s. Else blocking error toast with reason.
- FR1.4: Show progress: `Decoding → Analyzing pitch (x%) → Segmenting → Ready`. Allow cancel.
- FR1.5: Monophonic assumption banner: “Best with solo voice, no instruments.”
- **Accept:** 60 s MP3 decodes <1 s on desktop i5, waveform preview shown.

### FR2 — Pitch Analysis & Segmentation
- FR2.1: Run in `pitchTrack.worker.ts` with `aubiojs` YIN. Hop 10 ms (hop 441 @44.1k, window 1024). Range 50–1200 Hz.
- FR2.2: Per frame output: `f0Hz, confidence 0–1, rmsDb`. Voiced if `conf ≥0.7 && rms ≥ -40 dB`. Else unvoiced gap.
- FR2.3: Median filter voiced f0 over 5 frames (±20 ms). Convert: `midiFloat = 69 + 12*log2(f0/440)`. Store `curve: float32[]` per 10 ms + `voicedMask`.
- FR2.4: Segment to chunks:
  - min-note 80 ms,
  - merge gap <40 ms if both sides same semitone ±50 cents,
  - split on jump >100 cents sustained >50 ms,
  - discard chunks <60 ms or fully unvoiced.
  - `baseMidi = round(median(midiFloat))`, `centsOffset = 100*(median - baseMidi)`, `startSec/endSec` from voiced boundaries.
- FR2.5: Never auto-tune curve. Store natural curve + base.
- FR2.6: Performance <2 s for 60 s, progress callbacks, cancellable.
- **Accept:** vibrato visible like screenshot; breaths/silence produce gaps, not random notes.

### FR3 — Piano-Roll Visualization
- FR3.1: Layout: TopBar (file name, BPM input, key selector, Show/Snap grid, transport, master vol, save/export) | Left Piano 120 px | Center Canvas | Right V-scrollbar | Bottom H-scrollbar + minimap. Dark theme `#1E2A36` bg, `#111A23` header.
- FR3.2: Y axis C2–C6 (MIDI 36–84, 48 notes). `y = (maxMidi - midi)*pxPerNote`. pxPerNote 4–96. X axis `x = sec*pxPerSec`. pxPerSec 5–600. Pan via wheel, middle-drag, scrollbars.
- FR3.3: Grid: white-key rows `#2A3A4A`, black-key rows `#22303E`. In-key rows full brightness, out-of-key 45% dim. Beat thin `#334455`, bar thick `#4A6076`.
- FR3.4: Chunk draw: rounded rect voice color @30% fill + 1.5 px border (selected 2.5 px white, out-of-key red `#EF4444`). Orange curve `#E89A2E` 2 px polyline of `midiFloat`. White vibrato fill under curve @40%.
- FR3.5: Playhead 2 px orange vertical + triangle marker in ruler. Ruler shows `bar.beat` (from BPM, 4/4, 0 at 0 s) + `0.0s`. Time numbers 1,2,3,4,5 like screenshot.
- FR3.6: Piano: keys drawn, labels C2..C6, hover highlight, click → sampled piano preview (sine fallback). In key-highlight mode keys collapse to 2 colors (white = in key, gray = out). Current playhead pitch range auto-scroll optional.
- FR3.7: Virtualization: only draw chunks intersecting viewport. 60 fps pan/zoom to 500 chunks. Use single `<canvas>` + `devicePixelRatio` scaling, `requestAnimationFrame` throttling.
- **Accept:** matches screenshot ergonomics; zoom buttons + wheel gestures work.

### FR4 — Selection & Move
- FR4.1: Tools: `Select (V)`, `Cut (C)`. Esc clears, Del deletes selected.
- FR4.2: Click selects one (clears others unless Shift). Shift-click toggles add. Marquee-drag on empty space selects intersecting chunks (across voices if `All` view, else active voice only — setting).
- FR4.3: Drag body moves: `dMidi = round(-dy/pxPerNote)`, `dSec = dx/pxPerSec` (if Snap-to-Grid ON: `newStart = round(newStart/beatDur)*beatDur`). Live ghost + tooltip `E4 +700c, 12.34s`.
- FR4.4: Pitch clamp C2–C6, time clamp ≥0. Same-voice overlap prevention: clamp/slide to touch (no overlap). Cross-voice overlap allowed.
- FR4.5: Keyboard: Left/Right ±10 ms (Shift ±100 ms, +Snap → ±1 beat), Up/Down ±1 semitone, Shift+Up/Down ±12. All undoable.
- FR4.6: Undo/redo stack 50, Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y. Every mutation pushes inverse patch.
- **Accept:** multi-select 20 notes group move preserves intervals; <50 ms visual feedback.

### FR5 — Cut / Delete / Trim
- FR5.1: Cut tool active → cursor scissors → click chunk at `t` (must be ≥40 ms from edges) splits into `A [start,t)`, `B [t,end)`, curve array split proportionally, `baseMidi` recomputed per side (median). Select B after split.
- FR5.2: Del deletes selected chunks (any voice). If voice empty, voice remains (can delete voice separately).
- FR5.3: Right-edge drag trims: changes `endSec` ±, min length 60 ms, max extends into silence up to +500 ms (no audio stretch — extension renders silence/held tail). No left-edge stretch V1, left edge fixed (move whole chunk to shift).
- FR5.4: No merge V1 (workaround: delete + trim).
- **Accept:** cut + move + undo round-trips without curve corruption.

### FR6 — Voices (up to 5)
- FR6.1: Model `voices: Voice[1..5]`. Voice0 white `#F2F6FA` = original timing/pitch. New voice = deep copy chunks of source voice (default White) + transpose delta.
- FR6.2: Colors fixed palette: `0 white #F2F6FA, 1 blue #4AA8FF, 2 green #4ADE80, 3 purple #C084FC, 4 amber #FB923C`. Canvas opacity: active 100%, inactive 55%.
- FR6.3: Voice header tabs: color dot, name (Voice 1.. editable), M/S, volume slider 0–1.5 default 1.0, octave `-12/+12`, `Snap to Key`, duplicate (if <5), delete (if >1). Solo logic: if any solo → only solos audible; mute overrides.
- FR6.4: View filter: All voices dimmed vs isolate (solo-focus follows M/S).
- FR6.5: Transpose presets on duplicate: `+3 (m3), +4 (M3), +7 (P5), +12 (oct), -12`. Plus custom semitone input `-24..+24`.
- **Accept:** create blue at +7, move blue notes independently, white unchanged, both play in sync.

### FR7 — Key / Scale Highlight + Snap
- FR7.1: Selector: root `C,C#,D,...,B` + mode `Major/Minor` = 24. Theory in `theory.ts`: semitone sets e.g. Major `[0,2,4,5,7,9,11]`, Minor `[0,2,3,5,7,8,10]`. `Key` toggle next to Grid/Snap switches row + piano highlight (default ON).
- FR7.2: Visual: in-scale rows bright, out-of-scale dimmed; out-of-key chunk red border + `⚠` in tooltip.
- FR7.3: `Snap to Key` scope: selected chunks if any, else all chunks in that voice. For each: find nearest in-scale MIDI (nearest distance, tie → down). Apply rigid transpose (`baseMidi=new, curve+=delta`). Undoable as batch.
- FR7.4: Optional `Magnet` toggle per project: when ON, pitch drags snap to nearest in-scale (instead of chromatic). Default OFF V1.
- FR7.5: White voice snap default OFF (confirm dialog if user snaps white: “This alters original tuning — continue?”). Other voices default manual.
- **Accept:** C Major + select all blue → all red borders gone.

### FR8 — BPM Grid
- FR8.1: Inputs: BPM number 40–240 default 120, display 4/4 fixed. `beatDur=60/bpm`, `barDur=4*beatDur`.
- FR8.2: Toggles: Show Grid (default ON), Snap-to-Grid for time moves (default OFF). Grid does not affect pitch snapping (always chromatic/magnet).
- FR8.3: Ruler: bar numbers + `bar.beat` ticks. No downbeat offset, no time-sig change, no auto-detect V1.
- **Accept:** 120 BPM → bar lines every 2 s, dragging with snap lands on beats.

### FR9 — Advanced Edit Modal (double-click)
- FR9.1: Trigger: double-click chunk (or Enter with single selection). Modal shows: note name + octave (e.g. `A4 +23c`), confidence %, duration ms, voice color.
- FR9.2: Actions:
  - a) `Smart Re-center`: `delta = baseMidi_nearest - median(curve)` → `curve+=delta, baseMidi=nearest`. Preserves shape.
  - b) `Flatten 0–100%`: `curve[i] = lerp(curve[i], baseMidi, k)`. Live preview curve.
  - c) `Fine ±50c`: `curve+=fine/100`.
  - d) `Reset`: restore chunk’s post-segmentation state.
- FR9.3: Apply/Cancel, Apply pushes undo. Flatten default 0 (natural).
- **Accept:** wobbly note → Re-center → centered but vibrato intact; Flatten 100 → straight line.

### FR10 — Transport / Mixer
- FR10.1: Controls: Play/Pause (Space, also button), Stop (S, returns to 0 or last start), click ruler seek, Loop-all toggle (loops full project duration), master volume 0–1.5, time display `mm:ss.mmm / mm:ss.mmm`.
- FR10.2: Engine: on Play, ensure all voice buffers rendered fresh, then `AudioContext.currentTime+0.1` start all `BufferSource`s together. Playhead via `requestAnimationFrame` from `startTime+offset`. Pause stores offset. Scrub while playing restarts at new offset.
- FR10.3: No pan/reverb/EQ/metronome/click V1.
- **Accept:** white+blue in sync <5 ms drift over 60 s, Space toggles reliably.

### FR11 — Persistence & Export
- FR11.1: Autosave debounce 1 s after mutation to IndexedDB (`harmony-db`, store `projects`, `audioBlobs`) via Dexie. Includes `f0Curve` cache to skip re-analysis.
- FR11.2: Save/Load `.harmony.json`: `{version:1, bpm, key, voices, chunks, f0Meta}` + separate audio ref. On load without audio: prompt “Locate original MP3/WAV” → re-link + re-render.
- FR11.3: Export master WAV 44.1 kHz 16-bit via OfflineAudioContext bounce (sum voices × volumes × master). Download `harmony-mix.wav`.
- FR11.4: Export MIDI via `@tonejs/midi`: 1 track/voice, `note = baseMidi, startSec, durSec, vel 90`. Download `harmony.mid`.
- FR11.5: No MP3 export, no cloud/share-link V1.
- **Accept:** reload restores edits; WAV opens in Audacity; MIDI opens in DAW with 2 tracks.

---

## 3. Non-Functional Requirements

- **NFR1 Performance:** Analysis <2 s / 60 s audio (desktop i5, Chrome). Decode <1 s. Drag ghost <50 ms. Voice re-render <500 ms/edit (debounced, worker). Pan/zoom 60 fps to 500 chunks. Bundle <2 MB gz (lazy WASM).
- **NFR2 Responsiveness / UX:** Single canvas, no per-note DOM. Optimistic UI (move ghost instantly, audio re-render async). Empty/loading/error states for every async step. Keyboard fully operable for move/cut/delete/transport.
- **NFR3 Compatibility:** Desktop-first Chrome/Edge 120+ primary, Firefox/Safari best-effort (WASM fallback to JS YIN). PWA installable, offline after first load. Min 1280×720. No mobile touch editing V1 (view + play only).
- **NFR4 Reliability:** No data loss: autosave + beforeunload guard if dirty + rendering. All edits undoable. Corrupt project file → error + keep current project.
- **NFR5 Privacy/Security:** 100% local, no upload, no analytics V1, no backend. File access only via picker. CSP strict, no inline eval.
- **NFR6 Accessibility:** Contrast AA for text, focus rings, aria-labels on transport/mixer, piano keys keyboard-accessible (arrows + Enter to preview), Lighthouse a11y >90.
- **NFR7 Maintainability (clean for future):** Strict TS, no `any`, DSP pure + tested, AudioEngine behind interface, feature flags for V2. See §9.
- **NFR8 Tuning:** A=440 fixed, 12-TET only. No custom temperament V1.

---

## 4. UI/UX Spec (must-match screenshot ergonomics)

- Theme: bg `#1E2A36`, header `#111A23`, text `#E6EEF5`, accent orange `#E89A2E`, grid `#2A3A4A`. Font Inter/system.
- TopBar left: file name + duration + dirty dot. Center: BPM input, key selector, Show/Snap checkboxes, Magnet. Right: Play/Pause/Stop/Loop, master vol, Save/Load/Export WAV/Export MIDI.
- VoiceTabs below TopBar: 5 tabs max, each with color, M/S, vol, octave, snap, duplicate/delete. `+ Add voice` disabled at 5.
- Left Piano 120 px sticky, C labels. Center canvas flex-1. Right 12 px V-scroll, bottom 16 px H-scroll + minimap (mini curve overview, click to jump).
- Cursors: Select `default`, hover chunk `move`, edge `ew-resize`, Cut `crosshair`. Tooltip on drag: `E4 (+7st) @ 12.34s`.
- Shortcuts: `V select, C cut, Space play/pause, S stop, L loop, Del delete, Esc clear, Ctrl+Z/Y undo/redo, Arrows move, Shift+Arrows octave/100ms, Dbl-click advanced, H/V −/+ zoom, 100% reset (Ctrl+0), wheel V-zoom to cursor, Ctrl+wheel H-zoom to cursor, Shift+wheel H-pan, middle-drag pan, ? help`.
- States: empty (dropzone illustration), analyzing (progress bar + cancel), ready, dirty, rendering (tiny spinner on voice tab), error toasts.

---

## 5. Data Model (TypeScript)

```ts
type VoiceId = string;
type Frame = { f0Hz:number; midiFloat:number; conf:number; rmsDb:number; voiced:boolean };
type Chunk = {
  id:string; voiceId:VoiceId;
  startSec:number; endSec:number;
  baseMidi:number; // int 36..84
  centsOffset:number; // avg deviation at creation
  curve:number[]; // midiFloat per 10ms, length = round((end-start)*100)
  origBaseMidi:number; // for delta calc
  pristineCurve:number[]; // for Reset
};
type Voice = { id:VoiceId; name:string; color:string; mute:boolean; solo:boolean; volume:number; chunks:Chunk[] };
type Project = {
  version:1; name:string; durationSec:number;
  bpm:number; key:{root:number; mode:'major'|'minor'}; magnet:boolean;
  showGrid:boolean; snapToGrid:boolean; highlightKey:boolean;
  voices:Voice[]; f0:Frame[]; sampleRate:number;
};
```

- Pitch shift delta per chunk: `deltaSemi = (chunk.baseMidi - chunk.origBaseMidi) + fine/100` (fine from modal, stored as extra field `fineCents` if needed).
- IDs via `nanoid`. Time in seconds float64, pitch in MIDI float.

---

## 6. DSP Design

### 6.1 Pitch tracking
- `aubiojs` YIN, `bufferSize 1024, hop 441, samplerate 44100`. JS fallback `pitchy` YIN if WASM fails.
- Frame 10 ms. Confidence threshold 0.7, RMS -40 dB (computed per hop). Unvoiced → gap.
- Median 5 + Hampel outlier reject (>200c jump single frame → interpolate).

### 6.2 Segmentation
Pseudo:
```
voicedRuns = contiguous voiced frames
for run: smooth midiFloat, compute semitone seq = round(midi)
split when |median(last 5)-median(next 5)| > 1.0 semitone sustained 5 frames
merge gaps <40ms if neighbors same semitone ±0.5
drop <60ms
chunk.curve = midiFloat slice, baseMidi = round(median), centsOffset = 100*(median-base)
```

### 6.3 Pitch-shift + render (core quality)
- Lib: `rubberband-wasm` (best formant/time preservation). Fallback `soundtouchjs` WSOLA.
- Per voice render (in worker):
```
out = Float32Array(duration*sr) zeros
for chunk in sorted(chunks):
  src = originalBuffer.slice(chunkOrigStart, chunkOrigEnd) // orig timing = pristine timing for white; for harmonies use same src segment
  shifted = rubberband(src, semitones=deltaSemi, formantPreserve=true)
  // shifted length ≈ src length (time-preserved)
  place shifted at edited startSec with 5ms Hann crossfade, apply chunk gain
```
- Cache per voice `AudioBuffer`; invalidate only edited voice on edit (debounce 150 ms). Show spinner.
- White voice with zero edits = bit-identical original (skip shift).

---

## 7. Tech Stack

- **App:** `Vite 5 + React 18 + TypeScript 5 strict + Tailwind + Zustand + React-Router (single route V1) + PWA (vite-plugin-pwa)`.
- **Canvas:** raw Canvas2D + DPR scaling, no Konva/Three. Minimap second canvas.
- **Audio:** native WebAudio, `dexie` IDB, `aubiojs`, `rubberband-wasm` (lazy import), `@tonejs/midi` for export, `wavefile` or hand WAV encoder.
- **Utils:** `nanoid`, `tone` note names only (no Tone playback V1 to avoid overhead).
- **Quality:** `ESLint + Prettier + Vitest + Playwright + GH Actions`. Bundle analyze, Lighthouse CI.
- **No backend.** Fully static, deployable to Vercel/Netlify/GH Pages or Electron later.

Why: fastest local DSP, smallest bundle, easiest to keep pure DSP/testable, easy V2 swap (e.g. CREPE, AI harmony service).

---

## 8. Architecture & Clean-Code Rules

```
src/
  app/        App.tsx, TopBar.tsx, VoiceTabs.tsx, layout
  store/      projectStore.ts (zustand), selectionStore.ts, undo.ts
  dsp/        pitchTrack.worker.ts, segment.ts, theory.ts, audioUtil.ts  // pure, no React
  audio/      engine.ts (interface), webEngine.ts, renderVoice.worker.ts, exportWav.ts, exportMidi.ts
  editor/     PitchCanvas.tsx, Piano.tsx, Ruler.tsx, Minimap.tsx, tools/{select.ts,cut.ts,move.ts}, useZoomPan.ts
  modals/     AdvancedEdit.tsx
  persist/    idb.ts, fileSaveLoad.ts
  ui/         Toast, Modal, Slider, ShortcutsHelp
```

- Rules: `dsp/` pure functions + Vitest, no DOM/Audio imports. `audio/engine.ts` interface `IEngine {play,pause,seek,renderVoice...}` so V2 synth/VST can implement. Feature flags `flags.ts` (`AI_HARMONY=false`). Strict TS `noUncheckedIndexedAccess`. Max file 300 LOC, components memoized. All strings/constants in `constants.ts` (colors, C2–C6, thresholds).

---

## 9. Testing & Acceptance

- Unit (Vitest): theory scales/snap, segment splits/merges, midi<->freq, WAV/MIDI encoders.
- Integration: load fixture `sine sweep + vibrato wav` → expect chunks ±10 ms, base ±5c.
- E2E (Playwright): upload, duplicate +7, move, cut, snap-to-key, play 2 s, export WAV/MIDI non-empty.
- Manual: 3 samples (clean/hummy/noisy) + 500-chunk stress for 60 fps.
- Perf budgets enforced in CI (analysis time log, bundle size).

---

## 10. Risks & Mitigations

- Shift quality/CPU heavy → cap parallel renders to 1 worker, cache, fallback SoundTouch, limit 120 s.
- Noisy f0 (fry, breath) → confidence slider V1.1, manual delete/cut covers V1.
- Browser WASM differences → JS fallback + error message.
- Timing drift → single clock (`AudioContext.currentTime`), Offline bounce for export.

---

## 11. V2 Roadmap (not V1, keep seams)
AI suggest harmony (key + voice-leading), formant slider, reverb/delay/EQ/pan, tap-tempo/auto-BPM + downbeat offset, region loop, time-sig, merge + left-stretch + time-stretch, MP3 export, cloud share, mobile touch, VST/AU, polyphonic piano.

## 12. Glossary
f0=fundamental Hz, cents=1/100 semitone, chunk=edited note block, voice=parallel harmony layer, baseMidi=snapped center, curve=natural midiFloat trajectory, magnet=constrain drags to key, ghost=live drag preview.

---

# PART B — STEP-BY-STEP IMPLEMENTATION IN CODE

Do in order. Each milestone ends with runnable app + acceptance check. Estimated total 12–15 solo dev-days.

## M0 — Scaffold (0.5 day)
1. `npm create vite@latest harmony-gen -- --template react-ts && cd harmony-gen && npm i zustand tailwindcss dexie nanoid && npm i -D vitest playwright eslint prettier vite-plugin-pwa`
2. Init Tailwind, PWA manifest (name Harmony Gen, offline cache `/`), ESLint strict, `tsconfig strict + noUncheckedIndexedAccess`.
3. Create tree from §8 with stubs + `constants.ts` (colors, MIDI_C2=36, MIDI_C6=84, A440=440, HOP_SEC=0.01).
4. `App.tsx` layout: TopBar stub + Piano stub + `<canvas>` dark bg + scrollbars. Hardcode 2 fake chunks to verify Y/X math.
5. `npm run dev` → empty piano-roll C2–C6 renders.
- ✅ Check: zoom constants compile, canvas DPR crisp.

## M1 — Ingest + Transport + Persist skeleton (1–2 days)
1. `audio/audioUtil.ts`: `decodeFile(file): AudioBuffer mono`, validate ext/size/duration, `mixToMono()`.
2. `persist/idb.ts`: Dexie `harmony-db` tables `projects,audioBlobs`; `autosave(project, blob)` debounced.
3. `store/projectStore.ts`: Zustand `{project:Project|null, status, bpm,key,showGrid,snapToGrid,masterVol, set...}`.
4. `audio/webEngine.ts`: `loadBuffer(), play(offset), pause(), seek(sec), getPlayhead()` with single clock. Master Gain.
5. UI: Dropzone + picker + progress bar + error toast. TopBar transport buttons + Space/S handlers + ruler click seek (needs M3 ruler, use temp input range).
6. Test with 60 s MP3: decode <1 s, play/pause/seek in sync.
- ✅ Check: reload → autosave restores buffer (skip f0 for now).

## M2 — Pitch-track + Segment (white voice only) (2–3 days)
1. `npm i aubiojs pitchy` (lazy). `dsp/pitchTrack.worker.ts`: receives `Float32Array mono, sr`, returns `Frame[]` with progress posts. YIN 1024/441, conf+rms, median-5.
2. `dsp/segment.ts` pure: implement §6.2. Unit tests with synthetic `curve` (sine + step) → expect splits.
3. Wire: after decode → post to worker → `voices=[white]` with chunks (`origBaseMidi=baseMidi`, `pristineCurve=copy`). Cache `f0` in store + IDB.
4. `editor/PitchCanvas.tsx` v1: draw grid + white blocks + orange curve + playhead (no edit yet). `Piano.tsx` static + click piano-sample preview (sine fallback).
5. Fixture: generate `test/vibrato.wav` (python sine 220 Hz + 5 Hz vibrato) → verify curve wobble visible.
- ✅ Check: analysis <2 s/60 s, breaths = gaps.

## M3 — Core Editor: zoom/pan/select/move/cut/trim/undo (3–4 days)
1. `editor/useZoomPan.ts`: `pxPerSec 5–600, pxPerNote 4–96, scrollX/Y`, wheel V-zoom to cursor, Ctrl/⌘+wheel H-zoom to cursor, Shift+wheel H-pan, middle-drag pan, labeled H/V buttons + 100% reset (Ctrl+0/+/−), custom V-scroll, minimap viewport rect.
2. `store/selectionStore.ts` + `undo.ts`: `{selectedIds, tool:'select'|'cut', pushUndo(patch)}` depth 50.
3. `editor/tools/move.ts`: hit-test chunk body vs right-edge (6 px) vs empty. Drag ghost (draw dashed preview + tooltip), on mouseup commit with same-voice overlap clamp. Keyboard moves.
4. Marquee: mousedown empty → rect → select intersecting. Shift-click toggle. Esc/Del.
5. Cut: tool `C` → click at `t` → split curve arrays, recompute base per side. Trim: right-edge drag updates `endSec` + truncates/pads curve (pad with baseMidi flat for silence extension).
6. Ruler + playhead RAF, bar.beat labels from BPM.
7. Playwright: move/cut/undo smoke.
- ✅ Check: 500 fake chunks pan 60 fps, drag <50 ms.

## M4 — Voices + Pitch-shift Render + Mixer (3–4 days)
1. `npm i rubberband-wasm soundtouchjs @tonejs/midi` (lazy rubberband).
2. `dsp/theory.ts`: scales, `nearestInScale(midi,key)`, `transposePreset()`.
3. `store` voices slice: `addVoice(sourceId, deltaSemi)`, `deleteVoice`, `setMute/Solo/Vol`, `applySnapToKey(voiceId)`, octave ±12.
4. `audio/renderVoice.worker.ts`: §6.3. Input `original mono + chunks + sr`, output `Float32Array`. Main thread caches `AudioBuffer` per voice, debounced 150 ms, spinner on tab.
5. `webEngine` upgrade: `playAll(voiceBuffers, volumes, solos/mutes, offset)` sample-accurate start. White zero-edit fast path (original buffer).
6. UI `VoiceTabs.tsx`: 5 tabs, palette §FR6.2, M/S/vol/octave/snap/duplicate/delete, `+ Add`. Canvas draws all voices (active opaque).
7. Test: duplicate white +7 → blue plays fifth in own voice, move blue independently.
- ✅ Check: sync drift <5 ms/60 s, re-render <500 ms/edit.

## M5 — Key/BPM/Advanced Edit (2 days)
1. Key selector UI + `theory` tint in canvas + red borders + `Snap to Key` batch + Magnet toggle (constrain `dMidi` landing to in-scale).
2. BPM inputs + Show/Snap toggles + grid lines (thin beat/thick bar) + ruler `bar.beat+sec`.
3. `modals/AdvancedEdit.tsx`: Dbl-click → modal with readout + Re-center + Flatten slider (live canvas preview) + Fine ±50c + Reset + Apply/Cancel. Push undo.
4. Confirm dialog when snapping white.
- ✅ Check: C Major snap clears red; flatten 100 → straight line.

## M6 — Save/Load/Export/Polish + PWA (2 days)
1. `persist/fileSaveLoad.ts`: `.harmony.json` save/load + re-link audio flow. Version check.
2. `audio/exportWav.ts`: OfflineAudioContext sum → 16-bit WAV download. `exportMidi.ts`: `@tonejs/midi` 1 track/voice.
3. Loop-all toggle (wrap playhead at duration), master vol, beforeunload guard, toasts, ShortcutsHelp modal (`?`), empty states.
4. PWA icons, offline test (airplane mode reload works), Lighthouse a11y pass, bundle <2 MB, README run instructions.
5. Full E2E: upload → +7 duplicate → cut → snap → play → WAV+MIDI export non-empty.
- ✅ Check: reload restores, WAV plays in Audacity, MIDI opens in DAW.

## Build & Run Commands (V1)
```bash
cd /home/brieuc/code/harmony-gen
npm install
npm run dev        # dev at localhost:5173
npm test           # vitest
npx playwright test
npm run build && npm run preview  # PWA preview
```

## Definition of Done V1
All FR1–FR11 acceptance checks pass, NFR budgets met, `prd.md` matches shipped behavior, no backend, no data loss on reload, exports open externally.
