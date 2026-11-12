# T-502: Build Windows en CI

| Campo         | Valor                             |
| ------------- | --------------------------------- |
| Estado        | en revisión                       |
| Asignado      | packager                          |
| Fase          | F5                                |
| Rama          | `feat/T-501-502-bundles`          |
| Depende de    | F4                                |
| Estimación    | S                                 |
| Skills útiles | `git-workflow`, `dev-environment` |

## Objetivo

Añadir soporte y validación de compilación continua en GitHub Actions para Windows (instalador NSIS / binario .exe), además de mantener la compilación en Linux, asegurando que los cambios no rompan la compatibilidad multiplataforma de Deskumi.

## Contexto

Deskumi debe compilar y ejecutarse en Windows (con soporte para ventana transparente y click-through mediante las APIs de Tauri y el subsistema de ventanas de Windows). En F5, el CI debe validar que tanto Linux como Windows construyan satisfactoriamente.

## Alcance

- Configuración de empaquetado para Windows en `src-tauri/tauri.conf.json`:
  - Soporte para instalador NSIS.
- Modificación del workflow `.github/workflows/ci.yml`:
  - Creación de un job matricial `build-release` o jobs específicos que compilen en `ubuntu-22.04` (Linux deb/appimage) y `windows-latest` (Windows NSIS/.exe).
  - Configuración de dependencias previas necesarias (Node.js, Rust toolchain, caché, dependencias del sistema en Ubuntu).
- **No incluye:** Certificados de firma de código EV/Authenticode de Windows (post v0.1).

## Criterios de aceptación

- [x] Configuración de Windows/NSIS en `src-tauri/tauri.conf.json`.
- [x] Job de compilación multiplataforma en matriz (`ubuntu-22.04`, `windows-latest`) en `.github/workflows/ci.yml`.
- [x] Verificación de frontend (`npm run check`) y Rust (`cargo fmt`, `cargo clippy`, `cargo test`).

## Handoff

### Qué se hizo

- Se configuró la sección `bundle.windows` en `src-tauri/tauri.conf.json` con configuración para instalador `nsis`.
- Se actualizó `.github/workflows/ci.yml`:
  - Se añadió el job matricial `build-release` ejecutándose en `push` a `main` y en `pull_request` (o tras jobs de verificación básica) probando tanto `ubuntu-22.04` como `windows-latest`.
  - En Ubuntu se instalan las librerías del sistema requeridas (`libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libxdo-dev`).
  - En Windows se utiliza el runner nativo de `windows-latest` con el toolchain de Rust y Node.js.
  - Se ejecuta `npm ci` y `npm run tauri build`.

### Decisiones tomadas

- Se configuró el job de matriz `build-release` con `matrix: { os: [ubuntu-22.04, windows-latest] }` condicionado a la aprobación de los jobs `frontend` y `rust`.
- En Windows no se requieren dependencias de sistema GTK ya que Tauri utiliza WebView2 nativo de Edge/Windows.

### Entorno probado

- Fedora 44 x86_64 (Linux).
- `npm run check` (typecheck, lint, format check, vitest): OK.
- `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`: OK.
