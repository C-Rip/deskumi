# ADR-0002: Estrategia de click-through

- **Estado:** propuesta — **la cierra el spike T-103**
- **Fecha:** 2026-11-11
- **Autor(es):** crivera + agente
- **Tarea relacionada:** T-103

## Contexto

La ventana del personaje es más grande que el personaje. Los clics en zonas
transparentes deben llegar a la app de abajo; los clics sobre el personaje deben
llegar a nosotros (arrastrar, reaccionar).

`set_ignore_cursor_events(true)` de Tauri hace **toda** la ventana transparente a la
entrada. A diferencia de Electron, **no reenvía `mousemove`** mientras ignora eventos,
así que una vez activado el WebView ya no sabe cuándo el cursor vuelve al personaje.

## Opciones consideradas

1. **Input region (recomendada a priori).** El frontend calcula la silueta del
   avatar (bounding boxes gruesas, p. ej. rejilla de 16 px sobre el alpha del canvas
   o proyección de huesos) y la envía a Rust (`set_input_region`). Rust aplica la región:
   - Linux: `gtk::Widget`/`gdk::Window::input_shape_combine_region` sobre la ventana GTK
     (XShape en X11, `wl_surface.set_input_region` en Wayland).
   - Windows: `SetWindowRgn` o `WS_EX_LAYERED` + hit-test (por validar).
   - Pros: sin polling, funciona en Wayland nativo, cero latencia.
   - Contras: código nativo por plataforma; hay que recalcular la región cuando el
     avatar se mueve/anima (throttle ~10–15 Hz).
2. **Toggle por polling del cursor global.** Rust lee la posición global del cursor
   (~30–60 Hz), la compara con la silueta y llama a `set_ignore_cursor_events(bool)`.
   - Pros: simple, API pública de Tauri.
   - Contras: **no funciona en Wayland nativo** (no hay cursor global); polling cuesta CPU.
3. **Sin click-through parcial.** Ventana del tamaño exacto del personaje.
   - Pros: trivial. Contras: el bounding box sigue bloqueando clics; animaciones que
     salen del cuadro se recortan.

## Decisión (provisional)

Implementar **Opción 1** como primaria; **Opción 2** como fallback cuando
`caps.inputRegion == false`. **Opción 3** solo como último recurso.

El spike T-103 debe confirmar o refutar con evidencia en: Fedora GNOME (Wayland nativo
y XWayland), Nobara KDE (Wayland), y documentar la matriz en `ARCHITECTURE.md`.

## Consecuencias

- Se agrega el comando IPC `set_input_region` y `PlatformCaps.inputRegion`.
- Puede requerir dependencias `gtk`/`gdk` en Rust (Linux) — ya vienen transitivas con Tauri;
  usar las mismas versiones que Tauri para no duplicar.

## Evidencia

_Pendiente (T-103)._
