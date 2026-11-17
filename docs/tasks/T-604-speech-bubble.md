# T-604: `SpeechBubbleOverlay` (burbuja de diálogo sin resize GTK en vivo)

| Campo         | Valor                                                                                |
| ------------- | ------------------------------------------------------------------------------------ |
| Estado        | lista                                                                                |
| Asignado      | —                                                                                    |
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

- [ ] La burbuja se muestra con `say` / `speak` con texto y desaparece limpiamente al finalizar, interrumpirse u ocultarse la ventana.
- [ ] Posicionamiento automático dentro del viewport (arriba de `head` o lateral si no hay espacio superior) sin invocar `set_window_desktop_size`.
- [ ] `pointer-events: none` y click-through intacto sobre las zonas transparentes bajo la burbuja.
- [ ] Texto renderizado con `textContent` (protegido contra inyección HTML).
- [ ] `npm run check` pasa con tests unitarios de layout y ciclo de vida.

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

_Lo llena el agente al terminar: qué quedó, decisiones tomadas, deuda, siguientes pasos, entorno probado._
