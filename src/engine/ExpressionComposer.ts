import type { VRMExpressionManager } from "@pixiv/three-vrm";
import type { MouthVisemeName } from "./AvatarCommand";

export const MOUTH_VISEME_NAMES: readonly MouthVisemeName[] = [
  "aa",
  "ih",
  "ou",
  "ee",
  "oh"
] as const;

const NON_MOUTH_AFFECTING_EXPRESSIONS = new Set<string>([
  "blink",
  "blinkLeft",
  "blinkRight",
  "lookUp",
  "lookDown",
  "lookLeft",
  "lookRight",
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
  "neutral"
]);

export interface EmotionExpressionInput {
  name: string;
  weight: number;
}

export interface ComposeExpressionInput {
  blinkWeight: number;
  emotions: readonly EmotionExpressionInput[];
  mouthVisemes: Partial<Record<MouthVisemeName, number>>;
  isMouthActive: boolean;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Single-writer expression composer for `vrm.expressionManager`.
 * Combines procedural blink, active emotion/reaction presets, and mouth visemes
 * while honoring `overrideBlink` / `overrideMouth` and attenuating
 * mouth-affecting emotions during active lip-sync.
 */
export class ExpressionComposer {
  private readonly writtenExpressions = new Set<string>();
  private readonly desiredValues = new Map<string, number>();

  public composeAndApply(
    expressionManager: VRMExpressionManager | null | undefined,
    input: ComposeExpressionInput
  ): void {
    if (!expressionManager) {
      return;
    }

    const desired = this.desiredValues;
    desired.clear();

    let mouthPeak = 0;
    for (const v of MOUTH_VISEME_NAMES) {
      const w = clamp01(input.mouthVisemes[v] ?? 0);
      if (w > mouthPeak) mouthPeak = w;
    }

    let blinkMultiplier = 1.0;
    let mouthMultiplier = 1.0;
    let commandedBlink = 0;

    for (const emotion of input.emotions) {
      const rawWeight = clamp01(emotion.weight);
      if (rawWeight <= 0) continue;

      const exprMeta =
        typeof expressionManager.getExpression === "function"
          ? expressionManager.getExpression(emotion.name)
          : null;

      if (emotion.name !== "blink") {
        if (exprMeta?.overrideBlink === "block") {
          blinkMultiplier = 0;
        } else if (exprMeta?.overrideBlink === "blend") {
          blinkMultiplier = Math.max(0, blinkMultiplier - rawWeight);
        } else if (
          emotion.name === "blinkLeft" ||
          emotion.name === "blinkRight"
        ) {
          blinkMultiplier = Math.min(
            blinkMultiplier,
            Math.max(0, 1 - rawWeight)
          );
        }
      }

      let effectiveEmotionWeight = rawWeight;
      if (exprMeta?.overrideMouth === "block") {
        mouthMultiplier = 0;
      } else if (exprMeta?.overrideMouth === "blend") {
        mouthMultiplier = Math.max(0, mouthMultiplier - rawWeight);
      } else if (
        input.isMouthActive &&
        mouthPeak > 0 &&
        !NON_MOUTH_AFFECTING_EXPRESSIONS.has(emotion.name)
      ) {
        // Prevent emotions with overrideMouth === "none" from over-deforming
        // the jaw/mouth mesh when combined with open vowel visemes.
        effectiveEmotionWeight = rawWeight * (1 - 0.5 * mouthPeak);
      }

      if (emotion.name === "blink") {
        commandedBlink = Math.max(commandedBlink, effectiveEmotionWeight);
      } else if (effectiveEmotionWeight > 0) {
        const prev = desired.get(emotion.name) ?? 0;
        desired.set(
          emotion.name,
          Math.max(prev, clamp01(effectiveEmotionWeight))
        );
      }
    }

    const composedBlink = clamp01(
      Math.max(clamp01(input.blinkWeight) * blinkMultiplier, commandedBlink)
    );
    if (composedBlink > 0) {
      desired.set("blink", composedBlink);
    }

    for (const viseme of MOUTH_VISEME_NAMES) {
      const w = clamp01(input.mouthVisemes[viseme] ?? 0) * mouthMultiplier;
      if (w > 0) {
        const prev = desired.get(viseme) ?? 0;
        desired.set(viseme, Math.max(prev, clamp01(w)));
      }
    }

    for (const prevName of this.writtenExpressions) {
      if (!desired.has(prevName)) {
        expressionManager.setValue(prevName, 0);
      }
    }

    this.writtenExpressions.clear();
    for (const [name, weight] of desired) {
      expressionManager.setValue(name, weight);
      this.writtenExpressions.add(name);
    }
  }

  public reset(
    expressionManager: VRMExpressionManager | null | undefined
  ): void {
    if (expressionManager) {
      for (const name of this.writtenExpressions) {
        expressionManager.setValue(name, 0);
      }
    }
    this.writtenExpressions.clear();
    this.desiredValues.clear();
  }
}
