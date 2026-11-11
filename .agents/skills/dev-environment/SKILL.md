---
name: dev-environment
description: >-
  Preparación y verificación del entorno de desarrollo de Deskumi en Fedora,
  Nobara, Debian/Ubuntu y Windows (dependencias de sistema de Tauri v2, Node, Rust).
  Usar al configurar una máquina nueva, cuando falle la compilación por librerías del
  sistema, o antes de la primera ejecución de `npm run tauri dev`.
---

# Dev environment

## 1. Verifica
```bash
bash .agents/skills/dev-environment/scripts/check-env.sh
```
Reporta qué falta y el comando para instalarlo. Sal con código ≠ 0 si falta algo.

## 2. Instala dependencias de sistema (Tauri v2)

**Fedora / Nobara**
```bash
sudo dnf check-update
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel libxdo-devel
sudo dnf group install "c-development"
```

**Debian / Ubuntu**
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

**Windows**: Microsoft C++ Build Tools ("Desktop development with C++") + WebView2
(ya viene en Windows 11) + Rust con toolchain MSVC.

> Los agentes **no** deben ejecutar `sudo` por su cuenta: muestra el comando al usuario
> y espera confirmación.

## 3. Toolchains
- Node ≥ 20 (LTS) y npm. Rust stable vía `rustup` (`rustup update`).
- CLI de Tauri: se usa la local del proyecto (`npm run tauri ...`), no global.

## 4. Primera ejecución
```bash
npm ci
npm run tauri dev
```
La primera compilación de Rust tarda varios minutos (normal).

## Problemas comunes
| Síntoma | Causa | Solución |
| --- | --- | --- |
| `webkit2gtk-4.1 not found` (pkg-config) | falta paquete `-devel`/`-dev` | instalar según §2 |
| Ventana negra / sin transparencia | WebKitGTK + DMABUF/GPU | skill `linux-overlay-troubleshooting` |
| `failed to bundle` AppImage | falta `file`/FUSE | instalar `file`, `fuse` |
| Compilación Rust muy lenta | normal la 1ª vez | usa `cargo build` incremental; no borres `target/` |
