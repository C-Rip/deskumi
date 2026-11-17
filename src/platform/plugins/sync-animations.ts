import type { RegisteredAnimation } from "./plugins-ipc";
import type { RegisteredAnimationResolver } from "./RegisteredAnimationResolver";
import type { RegisteredAnimationConfig } from "../store-schema";

export interface SyncAnimationsDeps {
  listRegisteredAnimations: () => Promise<RegisteredAnimation[]>;
  registerAnimation: (
    id: string,
    path: string,
    label?: string
  ) => Promise<RegisteredAnimation | null>;
  unregisterAnimation: (id: string) => Promise<boolean>;
}

function animSignature(anim: RegisteredAnimationConfig): string {
  return JSON.stringify([anim.path, anim.label ?? null]);
}

/**
 * Synchronizes user-configured `.vrma` animations with the Rust plugin registry
 * and refreshes the frontend `RegisteredAnimationResolver` cache.
 */
export async function syncRegisteredAnimations(
  items: readonly RegisteredAnimationConfig[],
  syncedAnimations: Map<string, string>,
  animationResolver: RegisteredAnimationResolver,
  deps: SyncAnimationsDeps
): Promise<void> {
  const existing = await deps.listRegisteredAnimations();
  const existingUserIds = new Set(
    existing.filter((a) => a.source === "user").map((a) => a.id)
  );
  const desiredIds = new Set(items.map((a) => a.id));

  for (const userId of existingUserIds) {
    if (!desiredIds.has(userId)) {
      await deps.unregisterAnimation(userId);
      syncedAnimations.delete(userId);
      animationResolver.invalidate(userId);
    }
  }

  for (const anim of items) {
    const sig = animSignature(anim);
    if (syncedAnimations.get(anim.id) === sig && existingUserIds.has(anim.id)) {
      continue;
    }
    try {
      await deps.registerAnimation(anim.id, anim.path, anim.label);
      syncedAnimations.set(anim.id, sig);
      animationResolver.invalidate(anim.id);
    } catch (err: unknown) {
      console.warn(`[deskumi] Failed to register animation '${anim.id}':`, err);
    }
  }

  await animationResolver.refresh();
}
