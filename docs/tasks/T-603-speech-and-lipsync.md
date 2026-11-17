# T-603: Habla y _lip-sync_ (`AudioOutput`, `LipSyncController` y `SpeechController`)

| Campo         | Valor                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| Estado        | lista                                                                    |
| Asignado      | —                                                                        |
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

- [ ] `AudioOutput` crea `AudioContext` de forma perezosa, ejecuta `resume()` en frío sin gesto de usuario, reproduce PCM a 22050/44100/48000 Hz y llama `suspend()` tras inactividad.
- [ ] `LipSyncController` sincroniza visemas por `AudioContext.currentTime` y usa RMS sobre PCM como fallback determinista cuando no hay pista de visemas.
- [ ] `SpeechController` respeta máx. 8 ítems en cola, máx. 10 MB por stream, timeout de stream de 5 s y propiedad de `streamId` por dueño.
- [ ] Ningún camino de error, `speakCancel`, `timeout`, `hidden` o desconexión deja _wake locks_ activos en `PowerSaveController`.
- [ ] `npm run check` pasa limpio sin importar `@tauri-apps/*` desde `src/engine/**`.

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

_Lo llena el agente al terminar: qué quedó, decisiones tomadas, deuda, siguientes pasos, entorno probado._
