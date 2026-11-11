# T-102: Ventana transparente, sin bordes y siempre encima (+ workarounds Linux)

| Campo         | Valor                                            |
| ------------- | ------------------------------------------------ |
| Estado        | completada                                       |
| Asignado      | worker-102                                       |
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

- [x] Sin fondo negro/blanco ni sombra en E1 (XWayland y Wayland nativo).
- [x] Always-on-top funciona en modo XWayland.
- [x] `get_platform_caps` devuelve valores correctos (loguear en consola del WebView).
- [x] ADR-0003: sección Evidencia con resultados; estado → aceptada/rechazada.

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

### Implementado

- **Configuración de ventana:** `src-tauri/tauri.conf.json` configurado con ventana `main` de 400x600, `transparent: true`, `decorations: false`, `shadow: false`, `alwaysOnTop: true`, `skipTaskbar: true`, `resizable: false`.
- **Workarounds Linux:** `src-tauri/src/main.rs` aplica `GDK_BACKEND=x11` por defecto (a menos que `DESKUMI_WAYLAND=1`) y `WEBKIT_DISABLE_DMABUF_RENDERER=1` antes del inicio de WebKitGTK/Tauri, con variantes multi-SO condicionales (`#[cfg]`).
- **Detección de capacidades:** `src-tauri/src/platform.rs` con comando `get_platform_caps` que detecta display server (`x11`, `xwayland`, `wayland`, `win32`, `quartz`) y devuelve `PlatformCaps` respetando el contrato IPC tipado.
- **Frontend IPC y plataforma:** `src/platform/caps.ts` y `src/platform/ipc.ts` implementan la llamada a Tauri con fallback seguro cuando corre fuera de Tauri.
- **Escena Three.js de prueba:** `src/main.ts` inicializa `WebGLRenderer` con `alpha: true`, `premultipliedAlpha: true`, `setClearColor(0x000000, 0)`, resize handler reactivo y un cubo 3D rotando sobre fondo transparente. `src/styles/app.css` asegura transparencia completa.
- **ADR-0003:** Aceptada y documentada con la evidencia de validación en E1.

### Validación en E1

- Entorno: Fedora 44 (Workstation Edition), GNOME (sesión Wayland `wayland-0`), Intel HD Graphics 630, WebKitGTK 2.54.2.
- Q-01 (Arranque / Transparencia): ✅ OK (sin fondo negro ni sombras, transparencia completa con el cubo Three.js rotando).
- Q-02 (Always-on-top): ✅ OK en modo por defecto (XWayland).
- Q-07 (Bordes): ✅ OK (sin halos ni artefactos gracias a `premultipliedAlpha: true`).
- Comportamiento `DESKUMI_WAYLAND=1`: Inicia en Wayland nativo con capacidades degradadas reportadas por `get_platform_caps` (`displayServer: "wayland"`, `alwaysOnTop: false`).

### Siguiente tarea (T-103)

- T-103 implementará el click-through / hit testing y la definición de input region en `window.rs` / `Interaction.ts`. El backend XWayland configurado en T-102 proporciona soporte para XShape mientras que Wayland nativo requerirá wl_surface input region.
