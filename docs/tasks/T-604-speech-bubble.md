# T-604: `SpeechBubbleOverlay` (burbuja de diálogo sin resize GTK en vivo)

| Campo         | Valor                                                                                |
| ------------- | ------------------------------------------------------------------------------------ |
| Estado        | hecha                                                                                |
| Asignado      | subagent-T-604                                                                       |
| Fase          | F6                                                                                   |
| Rama          | `feat/T-604-speech-bubble`                                                           |
| Depende de    | T-602                                                                                |
| Estimación    | S (≤ 1 día)                                                                          |
| Skills útiles | `task-workflow`, `git-workflow`, `frontend-threejs`, `linux-overlay-troubleshooting` |

## Objetivo

Mostrar una burbuja de diálogo estilizada sobre el avatar cuando ejecuta `say` o `speak` con texto, anclada a la proyección en pantalla del hueso `head`, con `pointer-events: none` para preservar el _click-through_ y **sin** redimensionar la ventana GTK en vivo.

## Contexto

- [ADR-0006](../adr/0006-plugins-and-local-ws-bridge.md) y [phase-6-plan-v3-review.md](../plans/phase-6-plan-v3-review.md) (§3.3): llamar `set_window_desktop_size` al mostrar/ocultar burbujas provoca saltos visuales y recálculo de cámara/frustum en Mutter/KWin/XWayland.
- [`src/platform/window-perch.ts`](../../src/platform/window-perch.ts): coordina `minTopRoomPx` cuando el avatar está posado sobre una ventana.
- [`src/styles/app.css`](../../src/styles/app.css): ventana transparente sin scrollbars ni interferencia con el canvas WebGL.

## Alcance

- Incluye:
  - `src/platform/SpeechBubbleOverlay.ts` + reglas CSS en `src/styles/app.css`.
  - Anclaje 2D por proyección del hueso `head` del VRM (con fallback al bounding/posición del modelo) usando temporales preasignados.
  - Reposicionamiento automático dentro de los bordes del viewport: encima de la cabeza si hay margen superior suficiente, o a un costado estilo cómic si el personaje está cerca del borde superior (p. ej. en modo `perched`).
  - Coordinación de `minTopRoomPx` con `WindowPerchController` si corresponde.
  - `pointer-events: none` y `user-select: none` para que la burbuja nunca bloquee clics sobre el escritorio ni requiera ampliar `input_region`.
  - Escapado seguro de texto (`textContent`, cero `innerHTML` con texto de plugins/WS), animación sutil de entrada/salida y limpieza inmediata ante `speechEnd` (`interrupted`, `cancelled`, `timeout`, `hidden`).
  - Integración en el bucle de `SceneManager` / `main.ts` y tests unitarios en Vitest (`SpeechBubbleOverlay.test.ts`) cubriendo posicionamiento/clamp y ciclo de vida.
- **No incluye:** llamadas a `set_window_desktop_size`, síntesis de voz (`T-603`) ni entrada de texto interactiva en la burbuja.

## Pasos sugeridos

1. Implementar funciones puras de layout/clamp (`calculateBubblePosition`) dentro del viewport y probarlas en Vitest.
2. Implementar `SpeechBubbleOverlay` en `src/platform/SpeechBubbleOverlay.ts` con actualización por frame o por cambios de `head` y estilo en `src/styles/app.css`.
3. Suscribir la burbuja a los eventos `speechStart` / `speechEnd` (y texto de `say` / `speak` / `speakStart`) en `src/main.ts` / `AvatarController`.
4. Verificar manualmente con `npm run tauri dev` en modo normal y `perched` que el click-through fuera de la silueta permanece intacto y sin saltos de ventana.

## Criterios de aceptación

- [ ] La burbuja se muestra con `say` / `speak` con texto y desaparece limpiamente al finalizar, interrumpirse u ocultarse la ventana. _(API `show`/`hide`/`dispose` lista; conexión en `src/main.ts` diferida a Wave 3)_
- [x] Posicionamiento automático dentro del viewport (arriba de `head` o lateral si no hay espacio superior) sin invocar `set_window_desktop_size`.
- [x] `pointer-events: none` y click-through intacto sobre las zonas transparentes bajo la burbuja.
- [x] Texto renderizado con `textContent` (protegido contra inyección HTML).
- [x] `npm run check` pasa con tests unitarios de layout y ciclo de vida.

## Archivos esperados

- `src/platform/SpeechBubbleOverlay.ts` — crear
- `src/platform/SpeechBubbleOverlay.test.ts` — crear
- `src/styles/app.css` — añadir estilos de `.speech-bubble`
- `src/platform/window-perch.ts` — coordinar `minTopRoomPx` si aplica
- `src/main.ts` — conectar overlay a eventos de habla

## Verificación

```bash
npm run check
(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)
```

## Handoff

- **Qué se hizo:**
  - Funciones puras de layout/clamping en [`src/platform/speech-bubble-layout.ts`](../../src/platform/speech-bubble-layout.ts) (`calculateBubblePosition`, `computeTailOffset`) y re-exportadas desde [`src/platform/SpeechBubbleOverlay.ts`](../../src/platform/SpeechBubbleOverlay.ts).
  - Clase [`SpeechBubbleOverlay`](../../src/platform/SpeechBubbleOverlay.ts) + `projectHeadToScreen` con `THREE.Vector3` preasignado a nivel de módulo (`_headWorldPos`), fallback limpio a `neck` o `vrm.scene` cuando no existe hueso `head`, renderizado exclusivo con `textContent` (cero `innerHTML`), `pointer-events: none`, `user-select: none` y cero llamadas a `set_window_desktop_size`.
  - Estilos `.speech-bubble` en [`src/styles/app.css`](../../src/styles/app.css) con contraste alto sobre fondos claros/oscuros, `max-width` relativo al viewport, ajuste limpio de líneas, transición sutil de aparición/desaparición (y `prefers-reduced-motion`) y cola cómic orientada según `data-placement` (`above` | `left` | `right`).
  - Coordinación de `minTopRoomPx` en [`src/platform/window-perch.ts`](../../src/platform/window-perch.ts) (`DEFAULT_MIN_TOP_ROOM_PX`, opciones `minTopRoomPx` / `getMinTopRoomPx`, y `setMinTopRoomPx`), manteniendo el comportamiento existente.
  - Tests unitarios en [`src/platform/SpeechBubbleOverlay.test.ts`](../../src/platform/SpeechBubbleOverlay.test.ts) (11 tests) y [`src/platform/window-perch.test.ts`](../../src/platform/window-perch.test.ts) (+1 test, 7 totales).
- **Decisiones tomadas:**
  - Se separó la lógica matemática pura en `speech-bubble-layout.ts` (siguiendo el patrón de `input-region-math.ts`) para mantener cada archivo ≤ 300 líneas y permitir tests puros sin DOM/Three.
  - `hide()` conserva el texto mientras corre la transición de opacidad (160 ms) y limpia completamente en `dispose()` o al recibir texto en blanco (`show("   ")`).
  - `updateAnchor` omite lecturas/escrituras de DOM mientras la burbuja está oculta, pero guarda el último anclaje proyectado para que `show()` posicione al instante sin esperar al siguiente tick.
- **Siguientes pasos (Wave 3):**
  - Instanciar `SpeechBubbleOverlay` en `src/main.ts`, llamar `updateAnchor(ctx.vrm, sceneManager.camera, w, h)` dentro del loop y conectar `show`/`hide` a los eventos `speechStart`/`speechEnd` (y visibilidad de ventana).
  - Realizar verificación visual interactiva con `npm run tauri dev` en modo normal y `perched`.
- **Verificación / entorno:**
  - `npm run check` (`tsc --noEmit`, `eslint .`, `prettier --check .`, `vitest run`: 23 archivos, 219 tests) en verde.
  - `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` en Linux; sin ejecución GUI interactiva en sesión headless.
