# T-302: Arrastre de ventana interactivo (Drag & Drop)

| Campo         | Valor                                                            |
| ------------- | ---------------------------------------------------------------- |
| Estado        | completada                                                       |
| Asignado      | worker-302                                                       |
| Fase          | F3                                                               |
| Rama          | `feat/T-302-window-drag`                                         |
| Depende de    | T-201                                                            |
| Estimación    | S                                                                |
| Skills útiles | `linux-overlay-troubleshooting`, `task-workflow`, `git-workflow` |

## Objetivo

Permitir que el usuario mueva libremente la ventana de Deskumi por cualquier parte del escritorio agarrando al personaje o la ventana mediante clic izquierdo sostenido y arrastre, utilizando la API nativa de Tauri `getCurrentWindow().startDragging()`.

## Contexto

- [docs/ARCHITECTURE.md](../ARCHITECTURE.md#principios)
- [ADR-0003](../adr/0003-xwayland-default-on-linux.md)
- `getCurrentWindow().startDragging()` delega el movimiento al compositor del sistema operativo (funciona tanto en X11/XWayland como en Wayland y Windows de manera nativa).

## Alcance

- Incluye:
  - Módulo `src/platform/drag.ts` (o integración en `Interaction.ts`) con función `startDraggingWindow()`.
  - Detección de `mousedown` con botón izquierdo principal (`event.button === 0`).
  - Umbral mínimo de movimiento o inicio inmediato de arrastre sin romper clics simples futuros.
  - Fallback elegante si se corre en entorno de navegador para pruebas unitarias.
  - Conexión en `src/main.ts`.
- **No incluye:**
  - Raycast granular para seleccionar solo la ropa/malla (T-304).

## Criterios de aceptación

- [x] Hacer clic sostenido y arrastrar mueve la ventana por la pantalla en Fedora GNOME Wayland.
- [x] No genera errores de consola cuando se ejecuta fuera de Tauri (mock/fallback).
- [x] `npm run check` pasa al 100%.

## Verificación

```bash
npm run check
```

## Handoff

### Qué se implementó

1. **`src/platform/drag.ts`**:
   - `startDraggingWindow(windowApi?: DragWindowApi)`: invoca la API nativa de Tauri `getCurrentWindow().startDragging()` cuando `isTauri()` es true o delega a la instancia mock provista. Si corre en navegador o Vitest fuera de Tauri, efectúa fallback no-op sin arrojar excepciones ni generar warnings no deseados.
   - `isInteractiveElement(element: Element | null)`: detecta elementos interactivos (`<button>`, `<a>`, `<input>`, `<select>`, `<textarea>`, roles ARIA interactivos y elementos con `data-no-drag`) para no interceptar clics sobre controles o widgets.
   - `shouldStartDrag(event: MouseEvent, options?: DragConditionOptions)`: verifica que el evento sea el botón principal izquierdo (`event.button === 0`) y no provenga de un control interactivo (salvo configuración explícita).
   - `setupWindowDrag(options?: WindowDragSetupOptions)`: registra listeners (`mousedown`, opcional `mousemove`/`mouseup` con umbral de desplazamiento configurable) y provee función de limpieza `unbind()`. Por defecto ejecuta inicio inmediato en `mousedown` preservando el serial nativo requerido por Wayland/GTK.

2. **Permisos en `src-tauri/capabilities/default.json`**:
   - Agregado el permiso `"core:window:allow-start-dragging"` requerido por Tauri v2 para autorizar `plugin:window|start_dragging`.

3. **Integración en `src/main.ts`**:
   - Se activó el arrastre de ventana nativo llamando a `setupWindowDrag()` durante la inicialización de Deskumi.

4. **Tests unitarios (`src/platform/drag.test.ts`)**:
   - 12 pruebas unitarias en Vitest cubriendo filtrado de elementos interactivos (`isInteractiveElement`), validación de botón principal (`shouldStartDrag`), invocación nativa y fallback seguro fuera de Tauri (`startDraggingWindow`), y comportamiento inmediato, por umbral y desvinculación (`setupWindowDrag`).

### Siguientes pasos

- T-303: Click-through dinámico basado en máscara de píxeles/hit-testing.
- T-304: Interacción y raycasting sobre la malla del avatar VRM.
