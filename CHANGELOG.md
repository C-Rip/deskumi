# Changelog

Todos los cambios notables se documentan aquí.
Formato: [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) ·
Versionado: [SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Added

- Avatar oficial de muestra VRM 1.0 (`VRM1_Constraint_Twist_Sample.vrm`) verificado con licencia VRM Public License 1.0 y documentado en `CREDITS.md` (T-203).
- Ventana transparente sin decoraciones ni sombra, configurada en 400x600 con always-on-top y skip-taskbar (T-102).
- Workarounds de Linux para XWayland (`GDK_BACKEND=x11` salvo `DESKUMI_WAYLAND=1`) y prevención de fondo negro con WebKitGTK (`WEBKIT_DISABLE_DMABUF_RENDERER=1`) en `main.rs` (T-102).
- Comando IPC `get_platform_caps` y módulo de capacidades de plataforma (`platform.rs`, `caps.ts`, `ipc.ts`) detectando X11, XWayland y Wayland nativo (T-102).
- Escena de Three.js con cubo giratorio de prueba con `alpha: true`, `premultipliedAlpha: true` y fondo transparente (T-102).
- CI workflow endurecido en GitHub Actions con jobs paralelos para frontend (`npm check`), backend Rust (`cargo fmt`, `clippy`, `test`) y compilación Linux en `main`.
- Documentación de protección de ramas en `CONTRIBUTING.md` y badge de CI en `README.md`.
- Bootstrap del repositorio: documentación, ROADMAP, ADRs iniciales, reglas y skills
  para agentes, plantillas de GitHub, hooks de git y CI base.
