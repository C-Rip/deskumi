# T-603: Habla y _lip-sync_ (`AudioOutput`, `LipSyncController` y `SpeechController`)

| Campo         | Valor                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| Estado        | en revisión                                                              |
| Asignado      | subagent-T-603                                                           |
| Fase          | F6                                                                       |
| Rama          | `feat/T-603-speech-and-lipsync`                                          |
| Depende de    | T-602                                                                    |
| Estimación    | L (≤ 2 días)                                                             |
| Skills útiles | `task-workflow`, `git-workflow`, `frontend-threejs`, `three-vrm-recipes` |

## Objetivo

Implementar el subsistema de audio (`AudioOutput`), sincronización labial basada en el reloj de WebAudio (`LipSyncController`) y cola unificada de habla (`SpeechController`) para comandos `speak`, `speakStart`/`speakChunk`/`speakEnd`/`speakCancel` y `say`, con suspensión automática tras inactividad para mantener < 3 % de CPU en reposo.

## Contexto

- [ADR-0006](../adr/0006-plugins-and-local-ws-bridge.md): Resultados de `T-600` sobre `AudioContext` en WebKitGTK 2.54.2 (`state === "suspended"` inicial incluso con `autoplay: true` de `wry`, transición a `"running"` vía `ctx.resume()` en frío sin gesto de usuario, `defaultRate` 44100/48000 Hz, `suspend()` tras inactividad) y reparto de memoria (máx. 8 ítems en cola, máx. 10 MB de buffer por stream).
- [phase-6-plan-v4-review.md](../plans/phase-6-plan-v4-review.md) (§4: reloj único `AudioContext.currentTime`, pre-buffer ~100–150 ms, underrun, RMS determinista sin `AnalyserNode`, liberación garantizada de wake locks).

## Alcance

- Incluye:
  - `src/engine/AudioOutput.ts`:
    - Creación perezosa de `AudioContext` al primer `speak` / `speakStart` e invocación de `await ctx.resume()` para pasar a `"running"` en frío.
    - Creación de `AudioBuffer` con el `sampleRate` declarado por el stream (`8000..48000`) dejando que WebAudio remuestree al rate nativo del dispositivo.
    - Programación continua de `AudioBufferSourceNode` con pre-buffer inicial (~100–150 ms) y reloj acumulado; manejo limpio de _underrun_ (silencio, boca cerrada y reanudación ordenada sin solapar).
    - Auto-`suspend()` tras inactividad configurable (p. ej. 4 s sin audio activo) para cerrar el stream activo de PipeWire/PulseAudio.
  - `src/engine/LipSyncController.ts`:
    - Programación de visemas (`aa`, `ih`, `ou`, `ee`, `oh`, `neutral`) sincronizada contra `AudioContext.currentTime` (nunca acumulando `dt` del render).
    - Tiempos `t` de visemas en `speakChunk` interpretados como relativos al inicio del chunk actual; `"neutral"` cierra la boca sin invocar `expressionManager.setValue("neutral", ...)`.
    - Fallback determinista por amplitud RMS calculado sobre las muestras PCM recibidas (cero `AnalyserNode` y cero asignaciones en `update()`).
  - `src/engine/SpeechController.ts`:
    - Cola unificada para `speak`, `speakStart` / `speakChunk` / `speakEnd` / `speakCancel` y `say` (burbuja sin audio con `durationMs`), arbitrada por `policy: "queue" | "interrupt" | "drop"`.
    - Enforcement de límites: máx. 8 ítems en cola, máx. 10 MB de buffer en stream, timeout de inactividad por stream (5 s), propiedad de `streamId` por cliente/plugin (`cancelByOwner(owner)`), cancelación inmediata cuando la ventana se oculta (`reason: "hidden"`).
    - Adquisición y liberación de _active locks_ en `PowerSaveController` / `AvatarController` en todos los caminos (fin normal, interrupción, cancelación, timeout, ventana oculta, error o desconexión).
    - Emisión de eventos `speechStart { id }` y `speechEnd { id, interrupted, reason }`.
  - Tests unitarios en Vitest (`AudioOutput.test.ts`, `LipSyncController.test.ts`, `SpeechController.test.ts`) usando un clock/WebAudio mockeado determinista (incluyendo verificación de que ningún error o timeout deja un lock activo).
- **No incluye:** render DOM de la burbuja (`T-604`), servidor WebSocket (`T-605`), `PluginHost` (`T-606`), ni variante `audio: { url }` remota (descartada en ADR-0006).

## Pasos sugeridos

1. Implementar `src/engine/AudioOutput.ts` con adaptador inyectable de `AudioContext` para testeo determinista y auto-`suspend()`.
2. Implementar `src/engine/LipSyncController.ts` con cola de visemas por tiempo absoluto de audio y calculador RMS sin GC por frame.
3. Implementar `src/engine/SpeechController.ts` unificando `speak`, streams y `say`, con límites de cola/memoria, timeout de 5 s y wake locks.
4. Integrar `SpeechController` y `LipSyncController` en `AvatarController` (`src/engine/AvatarController.ts`) y `src/main.ts`.

## Criterios de aceptación

- [x] `AudioOutput` crea `AudioContext` de forma perezosa, ejecuta `resume()` en frío sin gesto de usuario, reproduce PCM a 22050/44100/48000 Hz y llama `suspend()` tras inactividad.
- [x] `LipSyncController` sincroniza visemas por `AudioContext.currentTime` y usa RMS sobre PCM como fallback determinista cuando no hay pista de visemas.
- [x] `SpeechController` respeta máx. 8 ítems en cola, máx. 10 MB por stream, timeout de stream de 5 s y propiedad de `streamId` por dueño.
- [x] Ningún camino de error, `speakCancel`, `timeout`, `hidden` o desconexión deja _wake locks_ activos en `PowerSaveController`.
- [x] `npm run check` pasa limpio sin importar `@tauri-apps/*` desde `src/engine/**`.

## Archivos esperados

- `src/engine/AudioOutput.ts` — crear
- `src/engine/AudioOutput.test.ts` — crear
- `src/engine/LipSyncController.ts` — crear
- `src/engine/LipSyncController.test.ts` — crear
- `src/engine/SpeechController.ts` — crear
- `src/engine/SpeechController.test.ts` — crear
- `src/engine/AvatarController.ts` — integrar canal `mouth` y `SpeechController`
- `src/main.ts` — conectar instancia de audio/habla

## Verificación

```bash
npm run check
(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)
```

## Handoff

- **Qué se hizo:**
  - `AudioOutput` ([`src/engine/AudioOutput.ts`](../../src/engine/AudioOutput.ts), [`AudioOutputTypes.ts`](../../src/engine/AudioOutputTypes.ts), [`AudioBufferSchedule.ts`](../../src/engine/AudioBufferSchedule.ts), [`PcmDecoder.ts`](../../src/engine/PcmDecoder.ts)): creación perezosa de `AudioContext` vía factory inyectable, `await ctx.resume()` en frío, decodificación base64 (`decodeAudioData`), streaming PCM (`pcm_s16le` / `pcm_f32le`, 8000–48000 Hz, mono/estéreo) con pre-buffer de 120 ms y reloj acumulado, manejo limpio de _underrun_ (silencio + cierre de boca + reanudación sin solapes) y auto-`suspend()` tras 4 s de inactividad.
  - `LipSyncController` ([`src/engine/LipSyncController.ts`](../../src/engine/LipSyncController.ts), [`LipSyncTypes.ts`](../../src/engine/LipSyncTypes.ts)): evaluación sincronizada contra `AudioOutput.currentTime` (sin acumular `dt` ni asignar memoria en `update()`), tiempos `t` relativos por chunk, `"neutral"` como boca cerrada sin escribir `"neutral"`, y fallback determinista por RMS sobre PCM sin `AnalyserNode`.
  - `SpeechController` ([`src/engine/SpeechController.ts`](../../src/engine/SpeechController.ts), [`SpeechTypes.ts`](../../src/engine/SpeechTypes.ts), [`SpeechSpeakHelper.ts`](../../src/engine/SpeechSpeakHelper.ts), [`SpeechStreamHelper.ts`](../../src/engine/SpeechStreamHelper.ts), [`SpeechCommandBuilders.ts`](../../src/engine/SpeechCommandBuilders.ts), [`SpeechStreamCommands.ts`](../../src/engine/SpeechStreamCommands.ts), [`SpeechQueueRuntime.ts`](../../src/engine/SpeechQueueRuntime.ts)): cola unificada (`say`, `speak`, `speakStart`/`Chunk`/`End`/`Cancel`, `stopSpeaking`) con políticas `queue`/`interrupt`/`drop`, límites ADR-0006 (máx. 8 en cola, máx. 10 MB por stream, timeout 5 s, aislamiento de `streamId` por dueño, cancelación inmediata al ocultar ventana con `reason: "hidden"`), emisión de `speechStart`/`speechEnd`, callbacks de burbuja (`onBubbleChange` / `getActiveBubble`) para `T-604`, y liberación garantizada de _wake locks_ en `PowerSaveController` en todos los caminos normales, cancelación, timeout, ocultamiento y error.
  - Integración en [`src/engine/AvatarMouthChannel.ts`](../../src/engine/AvatarMouthChannel.ts), [`src/engine/AvatarController.ts`](../../src/engine/AvatarController.ts), [`AvatarControllerTypes.ts`](../../src/engine/AvatarControllerTypes.ts) y [`AvatarControllerDispatch.ts`](../../src/engine/AvatarControllerDispatch.ts), manteniendo todos los archivos de implementación `<= 300` líneas.
  - Tests unitarios deterministas: [`src/engine/AudioOutput.test.ts`](../../src/engine/AudioOutput.test.ts), [`src/engine/LipSyncController.test.ts`](../../src/engine/LipSyncController.test.ts), [`src/engine/SpeechController.test.ts`](../../src/engine/SpeechController.test.ts) y ampliación de [`src/engine/AvatarController.test.ts`](../../src/engine/AvatarController.test.ts).
- **Decisiones tomadas:**
  - `AvatarMouthChannel` delega en `SpeechController` preservando las utilidades de override manual (`setMouthVisemes` / `clearMouthVisemes` / `setMouthActive`) y el comportamiento sin WebAudio para `say` o `speak` silenciosos sin crear `AudioContext` innecesariamente.
  - `src/main.ts` no se modificó por indicación explícita de integración en Wave 3 (`AvatarController` ya instancia `AudioOutput`, `LipSyncController` y `SpeechController` por defecto y acepta inyección opcional en `AvatarControllerOptions`).
- **Siguiente paso:**
  - En Wave 3 (`src/main.ts`), conectar `avatarController.onSpeechBubbleChange(...)` / `avatarController.speech` con `SpeechBubbleOverlay` (`T-604`) y el puente/plugins (`T-605`, `T-606`).
- **Entorno / Verificación:**
  - Verificado en Linux (worktree headless): `npx prettier --write`, `npm run check` (`tsc --noEmit`, `eslint .`, `prettier --check .`, `vitest run`) y `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` en `src-tauri/`. No se ejecutó prueba interactiva GUI (`npm run tauri dev`) desde el subagente headless.
