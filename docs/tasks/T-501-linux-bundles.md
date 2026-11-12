# T-501: Bundles Linux (.rpm, .deb, .AppImage)

| Campo         | Valor                                                      |
| ------------- | ---------------------------------------------------------- |
| Estado        | en revisión                                                |
| Asignado      | packager                                                   |
| Fase          | F5                                                         |
| Rama          | `feat/T-501-502-bundles`                                   |
| Depende de    | F4                                                         |
| Estimación    | S                                                          |
| Skills útiles | `linux-overlay-troubleshooting`, `git-workflow`, `qa-flow` |

## Objetivo

Configurar los metadatos y empaquetado para distribución en plataformas Linux (.deb, .rpm y .AppImage) en Tauri 2, asegurando compatibilidad con los entornos de escritorio soportados (GNOME/Fedora, Ubuntu/Debian).

## Contexto

Deskumi utiliza Tauri 2 como framework de aplicación nativa. La distribución en Linux requiere paquetes nativos para distribuciones basadas en Debian (.deb), distribuciones basadas en Red Hat / Fedora (.rpm) y un paquete portable autocontenido (.AppImage).

## Alcance

- Configuración de metadatos del bundle en `src-tauri/tauri.conf.json`:
  - `shortDescription`: `"Interactive 2D/3D desktop companion"`
  - `longDescription`: `"Desktop overlay showing interactive 3D VRM characters with transparent click-through"`
  - `category`: `"Utility"`
  - `copyright`: `"2026 Deskumi Contributors"`
  - Iconos de la aplicación en múltiples resoluciones.
  - Targets de empaquetado Linux (`deb`, `rpm`, `appimage`).
  - Dependencias del sistema necesarias en Linux (`deb` y `rpm`): WebKit2GTK 4.1, Ayatana AppIndicator, librsvg2, libxdo.
- **No incluye:** Automatización de firma de paquetes GPG ni repositorios PPA/COPR (post v0.1).

## Criterios de aceptación

- [x] Metadatos de bundle (`shortDescription`, `longDescription`, `category`, `copyright`) configurados en `src-tauri/tauri.conf.json`.
- [x] Targets Linux configurados para generar `.deb`, `.rpm` y `.AppImage`.
- [x] Dependencias de sistema de ejecución para Debian/Ubuntu y Fedora/RHEL declaradas en la configuración.
- [x] Verificación de frontend (`npm run check`) y compilación/lints Rust (`cargo fmt`, `cargo clippy`, `cargo test`).

## Handoff

### Qué se hizo

- Se actualizaron los metadatos de empaquetado en `src-tauri/tauri.conf.json`:
  - `shortDescription`, `longDescription`, `category`, `copyright`.
  - Configuración de sección `linux` con dependencias requeridas para `.deb` y `.rpm` (`libwebkit2gtk-4.1-0`, `libayatana-appindicator3-1`, `librsvg2-2`, `libxdo3` en Debian; `webkit2gtk4.1`, `libayatana-appindicator`, `librsvg2`, `libxdo` en RPM).
- Targets configurados como `"all"` para soportar `.deb`, `.rpm`, `.AppImage` en Linux y `.nsis` en Windows.

### Decisiones tomadas

- Se mantuvieron `targets: "all"` para que las herramientas de build de Tauri generen los bundles correspondientes al sistema operativo del host automáticamente o según las flags `--bundles`.
- Se especificaron las dependencias runtime requeridas de WebKit2GTK y librsvg para asegurar una instalación funcional sin dependencias faltantes en entornos limpios.

### Entorno probado

- Fedora 44 x86_64 (Linux).
- `npm run check` (typecheck, lint, format check, vitest): OK.
- `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`: OK.
