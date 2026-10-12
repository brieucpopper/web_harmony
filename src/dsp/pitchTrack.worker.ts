// Pitch tracking worker (M2 scope): aubiojs YIN, hop 10 ms, 50–1200 Hz.
// Not implemented in M1 — ingest stops after decode (status 'ready').
export const PITCH_TRACK_MILESTONE = 'M2' as const
