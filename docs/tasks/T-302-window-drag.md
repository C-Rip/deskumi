# T-302: Arrastre de ventana interactivo (Drag & Drop)

| Campo         | Valor                                                |
| ------------- | ---------------------------------------------------- |
| Estado        | lista                                                |
| Asignado      | —                                                    |
| Fase          | F3                                                   |
| Rama          | `feat/T-302-window-drag`                             |
| Depende de    | T-201                                                |
| Estimación    | S                                                    |
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
- [ ] Hacer clic sostenido y arrastrar mueve la ventana por la pantalla en Fedora GNOME Wayland.
- [ ] No genera errores de consola cuando se ejecuta fuera de Tauri (mock/fallback).
- [ ] `npm run check` pasa al 100%.

## Verificación
```bash
npm run check
```
