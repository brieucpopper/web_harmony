# Harmony Gen

Web-based vocal harmony generator, FL Newtone style: upload a monophonic voice
recording, see its pitch curve + note chunks on a piano-roll, build up to 5
harmony voices in your own voice, export WAV + MIDI. 100% local, no backend.

**Status:** M0 + M1 shipped (ingest, transport, persist skeleton). Next: M2
pitch-track + segmentation. See [`prd.md`](prd.md) (spec) and
[`PROGRESS.md`](PROGRESS.md) (what's built, what deviates, M2 handoff).

## Run

```bash
npm install
npm run dev        # localhost:5173
npm test           # vitest
npm run lint       # eslint, must be silent
npm run build      # PWA production build
npx playwright test
```

## How it works

`Upload MP3/WAV → decode to mono → pitch-track f0(t) → segment into note
chunks → edit / duplicate voices → pitch-shifted render per voice → mix →
export.`

- Limits: MP3/WAV, ≤20 MB, ≤120 s. Best with solo voice, no instruments.
- Piano-roll: C2–C6, wheel = V-zoom, Ctrl/⌘+wheel = H-zoom, Shift+wheel = pan,
  middle-drag = pan, Ctrl+0/+/− = zoom reset/in/out.
- `Space` play/pause, `S` stop, `L` loop, `?` shortcuts, `Esc` clear selection.
- Click piano keys for a sampled-piano preview.

## Stack

Vite 8 + React 19 + TypeScript strict + Tailwind 4 + Zustand + Dexie
(IndexedDB autosave) + Canvas2D + WebAudio. Desktop-first Chrome/Edge, PWA
offline. No backend.

## Layout

`src/app` shell · `src/store` zustand + undo · `src/dsp` pure DSP + workers ·
`src/audio` engine/render/export · `src/editor` canvas, piano, ruler, zoom/pan ·
`src/modals` · `src/persist` IDB + file save/load · `src/ui`.

Unimplemented milestones are compile-safe stubs — grep `lands in M`.

## Attribution

Piano preview samples: [fuhton/piano-mp3](https://github.com/fuhton/piano-mp3)
(from [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts)), MIT —
see [`public/piano/LICENSE.txt`](public/piano/LICENSE.txt).
