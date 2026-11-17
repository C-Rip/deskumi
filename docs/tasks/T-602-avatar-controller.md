# T-602: Contrato `AvatarCommand`/`AvatarEvent`, `AvatarController` y wake locks en `PowerSaveController`

| Campo         | Valor                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| Estado        | hecha                                                                    |
| Asignado      | subagent-T-602                                                           |
| Fase          | F6                                                                       |
| Rama          | `feat/T-602-avatar-controller`                                           |
| Depende de    | T-600, T-601                                                             |
| Estimación    | M (≤ 1 día)                                                              |
| Skills útiles | `task-workflow`, `git-workflow`, `frontend-threejs`, `three-vrm-recipes` |

## Objetivo

Definir el contrato versionado `AvatarCommand` / `AvatarEvent` (`v: 1`) con validación estricta, centralizar el arbitraje de animaciones/expresiones en `AvatarController` como escritor único de `vrm.expressionManager`, emitir la región de clic (`"head" | "body"`) mediante proyección del hueso `neck`, y añadir _active locks_ en `PowerSaveController`.

## Contexto

- [ADR-0006](../adr/0006-plugins-and-local-ws-bridge.md): Arquitectura de plugins, puente WS, validación estricta y presupuesto RAM/CPU.
- [`.agents/rules/frontend-threejs.md`](../../.agents/rules/frontend-threejs.md): `src/engine/**` no importa `@tauri-apps/*`.
- [phase-6-plan-v3-review.md](../plans/phase-6-plan-v3-review.md) (§1.3, §2.2, §2.4, §2.5) y [phase-6-plan-v4-review.md](../plans/phase-6-plan-v4-review.md) (§1.3, §1.4, §3).

## Alcance

- Incluye:
  - Esquema y validador en `src/engine/AvatarCommand.ts`:
    - Sobre entrante `{ v: 1, id?: string, cmd: AvatarCommand }` y respuestas `{ v: 1, type: "ack", ref?: string }` / `{ v: 1, type: "error", ref?: string, code: AvatarErrorCode, message: string }` con códigos cerrados (`"invalid" | "rate_limited" | "too_large" | "forbidden" | "busy" | "hidden" | "unknown_expression" | "unknown_animation"`).
    - Comandos soportados: `hello`, `speak`, `speakStart`, `speakChunk`, `speakEnd`, `speakCancel`, `say`, `stopSpeaking`, `expression`, `animation`, `lookAt`, `reaction`. Sin variante `audio: { url }` en v1.
    - Respuesta a `hello` con versión, límites vigentes, scopes concedidos, expresiones disponibles del avatar actual y animaciones registradas; soporte de suscripción selectiva `events?: AvatarEventType[]`.
    - Eventos salientes (`AvatarEvent`): `click { region: "head" | "body" }`, `speechStart { id? }`, `speechEnd { id?, interrupted, reason: "finished" | "interrupted" | "timeout" | "hidden" | "cancelled" }`, `idleChange { idle }`, `avatarChange { expressions }`, `windowFocus { appId?, title? }`.
    - `validateAvatarCommand(raw, limits, context)`: rechaza explícitamente (sin recortar en silencio) `text` > 500 chars, `visemes` > 256 entradas, `sampleRate` fuera de `8000..48000`, `intensity` / `w` fuera de `0..1`, `durationMs` fuera de `0..30_000`, `lookAt` fuera de `-1..1` y versión `v !== 1`.
  - `src/engine/AvatarController.ts` (implementa `System`):
    - Cuatro canales independientes (`lookAt`, `expression`, `mouth`, `pose`) con arbitraje por `policy: "interrupt" | "queue" | "drop"` según el comando entrante (independiente de si los dueños son dos plugins o clientes WS distintos).
    - **Único escritor sobre `vrm.expressionManager`** antes de `vrm.update(dt)`: compone parpadeo (`BlinkController`), reacción (`ReactionSystem`), emoción comandada y visemas vocales respetando `overrideBlink` y `overrideMouth` (y atenuando emoción si coincide con boca activa).
    - Visema `"neutral"` significa boca cerrada y **no** llama `expressionManager.setValue("neutral", ...)`.
    - Rechaza comandos con `error: "hidden"` cuando la ventana está oculta (`!powerSaveController.isWindowVisible`).
    - Calcula región `"head" | "body"` en clics sobre el avatar proyectando la posición mundial del hueso `neck` a coordenadas de pantalla.
  - `src/engine/PowerSaveController.ts`:
    - Métodos `acquireActiveLock(token: string)` y `releaseActiveLock(token: string)` respaldados por un `Set<string>` para sostener `activeFps` durante habla/animaciones/reacciones externas, rearmando el temporizador de reposo (`idleFps = 10`) al quedar en 0 locks.
    - Garantizar limpieza de locks en `dispose()` y rutas de cancelación/error/ocultamiento.
  - Tests unitarios en Vitest (`AvatarCommand.test.ts`, `AvatarController.test.ts`, `PowerSaveController.test.ts`).
- **No incluye:** `AudioOutput`/`LipSyncController` (`T-603`), `SpeechBubbleOverlay` (`T-604`), servidor WebSocket (`T-605`), host de plugins (`T-606`), ni secciones UI en Ajustes (`T-607`).

## Pasos sugeridos

1. Implementar `src/engine/AvatarCommand.ts` con tipos discriminados, límites exportados y `validateAvatarCommand`.
2. Añadir `acquireActiveLock` / `releaseActiveLock` a `src/engine/PowerSaveController.ts` y cubrirlo con `vi.useFakeTimers()` en tests.
3. Crear `src/engine/AvatarController.ts` centralizando escrituras a `vrm.expressionManager` (coordinando con `AnimationSystem` y `ReactionSystem` para evitar escrituras duplicadas) y cálculo de región `neck`.
4. Conectar `AvatarController` en `src/main.ts` / `src/platform/avatar-picker.ts` emitiendo `avatarChange` al cambiar de modelo y `click` con `region` al hacer clic sobre la silueta.

## Criterios de aceptación

- [x] `validateAvatarCommand` rechaza todos los casos inválidos o fuera de rango sin recortar en silencio ni importar `@tauri-apps/*`.
- [x] `AvatarController` es el único escritor de `vrm.expressionManager` antes de `vrm.update(dt)`, respetando `overrideBlink`/`overrideMouth` y tratando visema `"neutral"` como boca cerrada sin escribir `"neutral"`.
- [x] Los 4 canales (`lookAt`, `expression`, `mouth`, `pose`) arbitran correctamente `interrupt`, `queue` y `drop`, y rechazan comandos con `hidden` si la ventana está oculta.
- [x] `click` sobre el avatar clasifica `"head"` vs `"body"` proyectando el hueso `neck`.
- [x] `PowerSaveController` sostiene `activeFps` con locks activos y vuelve a `10 FPS` al liberarlos (incluyendo rutas de error, cancelación y `dispose()`).
- [x] `npm run check` pasa con todos los tests nuevos y existentes en verde.

## Archivos esperados

- `src/engine/AvatarCommand.ts` — crear
- `src/engine/AvatarCommand.test.ts` — crear
- `src/engine/AvatarController.ts` — crear
- `src/engine/AvatarController.test.ts` — crear
- `src/engine/PowerSaveController.ts` — modificar
- `src/engine/PowerSaveController.test.ts` — ampliar
- `src/engine/AnimationSystem.ts` y `src/engine/ReactionSystem.ts` — adaptar para delegar expresión en `AvatarController` (manteniendo fallback compatible con tests existentes)
- `src/main.ts` y `src/platform/avatar-picker.ts` — conectar `AvatarController` y proyección `neck`

## Verificación

```bash
npm run check
(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)
```

## Handoff

- **Qué se hizo:**
  - Contrato versionado `v: 1` y validador estricto (`unknown` narrowing sin `any`, cero imports de `@tauri-apps/*` ni DOM) en [`src/engine/AvatarCommand.ts`](../../src/engine/AvatarCommand.ts), [`AvatarCommandSchema.ts`](../../src/engine/AvatarCommandSchema.ts), [`AvatarCommandFieldReaders.ts`](../../src/engine/AvatarCommandFieldReaders.ts), [`AvatarCommandSpeechParsers.ts`](../../src/engine/AvatarCommandSpeechParsers.ts) y [`AvatarCommandValidator.ts`](../../src/engine/AvatarCommandValidator.ts), cubierto por [`AvatarCommand.test.ts`](../../src/engine/AvatarCommand.test.ts).
  - Controlador unificado [`src/engine/AvatarController.ts`](../../src/engine/AvatarController.ts) (implementando `System`) con [`ExpressionComposer.ts`](../../src/engine/ExpressionComposer.ts), [`AvatarChannels.ts`](../../src/engine/AvatarChannels.ts), [`AvatarAuxChannels.ts`](../../src/engine/AvatarAuxChannels.ts), [`AvatarMouthChannel.ts`](../../src/engine/AvatarMouthChannel.ts), [`AvatarPoseChannel.ts`](../../src/engine/AvatarPoseChannel.ts) y [`AvatarClickRegion.ts`](../../src/engine/AvatarClickRegion.ts), cubierto por [`AvatarController.test.ts`](../../src/engine/AvatarController.test.ts).
  - Adaptación retrocompatible de [`AnimationSystem.ts`](../../src/engine/AnimationSystem.ts), [`ReactionSystem.ts`](../../src/engine/ReactionSystem.ts) y [`LookAtSystem.ts`](../../src/engine/LookAtSystem.ts) para delegar `vrm.expressionManager`, `vrm.update(dt)` y overrides externos `lookAt` en `AvatarController`.
  - _Active wake locks_ (`acquireActiveLock`, `releaseActiveLock`, `hasActiveLocks`) y listeners `onIdleChange`/`onVisibilityChange` en [`PowerSaveController.ts`](../../src/engine/PowerSaveController.ts) con cobertura `vi.useFakeTimers()` en [`PowerSaveController.test.ts`](../../src/engine/PowerSaveController.test.ts).
  - Conexión en [`src/main.ts`](../../src/main.ts) (284 líneas), [`src/platform/avatar-picker.ts`](../../src/platform/avatar-picker.ts) y [`src/platform/app-listeners.ts`](../../src/platform/app-listeners.ts) emitiendo `avatarChange`, `idleChange` y `click { region }`.
- **Decisiones tomadas:**
  - `AvatarController` se mantiene persistente en `main.ts` y se adjunta/desadjunta en `setupAvatarInScene` / `teardownAvatarContext` para preservar suscripciones de eventos (`T-603`..`T-606`) entre cambios de modelo VRM.
  - Cuando `expressionManager` carece de `expressionMap` (mocks unitarios mínimos), se omite el chequeo `unknown_expression`, mientras que los VRM reales validan contra `Object.keys(expressionMap)`.
  - Si un emote con `overrideMouth === "none"` coincide con boca abierta (`mouthPeak > 0`), su peso se atenúa (`1 - 0.5 * mouthPeak`) para evitar sobredeformación bucal.
- **Siguientes pasos / desbloqueados:**
  - `T-603` (`AudioOutput` / `LipSyncController` / `SpeechController`), `T-604` (`SpeechBubbleOverlay`), `T-605` (puente WS) y `T-606` (`PluginHost` y registro `.vrma`) quedan desbloqueadas sobre el contrato `v: 1` y `AvatarController`.
- **Verificación / entorno:**
  - Verificado mediante `npm run check` (22 archivos de test, 207 tests), `cargo fmt --check`, `cargo clippy -- -D warnings` y `cargo test` en Linux; no se ejecutó prueba interactiva GUI con `npm run tauri dev` en esta sesión headless de subagente.
