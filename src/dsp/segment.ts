// Chunk segmentation, pure (M2 scope, PRD §6.2). Signature fixed now so M2 is drop-in.
import type { Chunk, Frame, VoiceId } from '../types'

export interface SegmentOptions {
  /** Min note length, seconds. Default 0.08. */
  minNoteSec?: number
  /** Merge gap threshold, seconds. Default 0.04. */
  mergeGapSec?: number
  /** Split on sustained jump, semitones. Default 1.0. */
  splitJumpSemi?: number
}

export function segmentFramesToChunks(
  _frames: Frame[],
  _voiceId: VoiceId,
  _options?: SegmentOptions,
): Chunk[] {
  throw new Error('segmentFramesToChunks lands in M2 — pitch-track the audio first.')
}
