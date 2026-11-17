import type { VisemeKeyframe } from "./AvatarCommand";

export interface LipSyncControllerOptions {
  /** Returns current audio playback time in seconds (e.g. `() => audioOutput.currentTime`). */
  getAudioTime: () => number;
  /** Analysis window duration in ms for PCM RMS fallback. @default 20 */
  rmsWindowMs?: number;
  /** RMS amplitude noise floor below which mouth remains closed. @default 0.015 */
  rmsNoiseFloor?: number;
  /** RMS amplitude mapped to 1.0 mouth openness. @default 0.265 */
  rmsPeakLevel?: number;
  /** Default tail duration in seconds for visemes lacking explicit duration. @default 0.08 */
  defaultVisemeTailSec?: number;
}

export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function compactNumberArrays(
  cursor: number,
  a: number[],
  b: number[],
  c: number[]
): void {
  if (cursor <= 0) return;
  a.splice(0, cursor);
  b.splice(0, cursor);
  c.splice(0, cursor);
}

export function sortVisemesAscending(
  visemes: readonly VisemeKeyframe[]
): VisemeKeyframe[] {
  return [...visemes].sort((a, b) => a.t - b.t);
}
