# T-102: Ventana transparente, sin bordes y siempre encima (+ workarounds Linux)

| Campo         | Valor                                            |
| ------------- | ------------------------------------------------ |
| Estado        | lista                                            |
| Asignado      | —                                                |
| Fase          | F1                                               |
| Rama          | `feat/T-102-transparent-window`                  |
| Depende de    | T-101                                            |
| Estimación    | M                                                |
| Skills útiles | `linux-overlay-troubleshooting`, `task-workflow` |

## Objetivo

Ventana principal 100 % transparente, sin decoraciones ni sombra, always-on-top y
sin entrada en la barra de tareas, mostrando un cubo Three.js girando como prueba visual.

## Contexto

- [ADR-0003](../adr/0003-xwayland-default-on-linux.md) (XWayland por defecto).
- Skill `linux-overlay-troubleshooting` para fondo negro / DMABUF / NVIDIA.

## Alcance

- Incluye: `tauri.conf.json` (`transparent`, `decorations: false`, `shadow: false`,
  `alwaysOnTop: true`, `skipTaskbar: true`, `resizable: false`), CSS transparente,
  renderer WebGL con `alpha: true` y `setClearColor(0x000000, 0)`, cubo de prueba,
  lógica de env vars en `main.rs` (ADR-0003), `src-tauri/src/platform.rs` con
  detección de display server y comando `get_platform_caps`.
- **No incluye:** click-through (T-103), avatar VRM (F2).

## Pasos sugeridos

1. Config de ventana en `tauri.conf.json` (tamaño inicial 400×600).
2. `main.rs`: en Linux, antes de `run()`, si no existe `DESKUMI_WAYLAND=1` y
   `GDK_BACKEND` no está definido → `GDK_BACKEND=x11`. Setear
   `WEBKIT_DISABLE_DMABUF_RENDERER=1` si no está definido. Loguear qué se aplicó.
   (Nota: `std::env::set_var` es `unsafe` en edición 2024; en 2021 es seguro pero hazlo
   antes de crear hilos.)
3. `platform.rs`: detectar `x11` / `xwayland` / `wayland` con `XDG_SESSION_TYPE`,
   `WAYLAND_DISPLAY`, `GDK_BACKEND`; devolver `PlatformCaps` (ver contrato IPC).
4. Frontend: `src/platform/caps.ts` con el tipo y la llamada; cubo de prueba en `main.ts`.
5. Probar en E1 en ambos modos y llenar Q-01, Q-02, Q-07 en el PR.

## Criterios de aceptación

- [ ] Sin fondo negro/blanco ni sombra en E1 (XWayland y Wayland nativo).
- [ ] Always-on-top funciona en modo XWayland.
- [ ] `get_platform_caps` devuelve valores correctos (loguear en consola del WebView).
- [ ] ADR-0003: sección Evidencia con resultados; estado → aceptada/rechazada.

## Archivos esperados

- `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`,
  `src-tauri/src/platform.rs`
- `src/main.ts`, `src/styles/app.css`, `src/platform/caps.ts`, `src/platform/ipc.ts`

## Verificación

```bash
npm run tauri dev                          # modo por defecto (XWayland)
DESKUMI_WAYLAND=1 npm run tauri dev # Wayland nativo
```

## Handoff

_Pendiente._
