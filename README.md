# Deskumi ✨

[![CI](https://github.com/C-Rip/deskumi/actions/workflows/ci.yml/badge.svg)](https://github.com/C-Rip/deskumi/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/C-Rip/deskumi?label=release)](https://github.com/C-Rip/deskumi/releases/latest)

Personajes 3D (VRM) y 2D interactivos viviendo en tu escritorio — ligero, open source
y **Linux-first** (Fedora, Nobara, Debian, Ubuntu; GNOME y KDE), con soporte completo para Windows.

> **Versión actual:** [v0.1.0](https://github.com/C-Rip/deskumi/releases/tag/v0.1.0) 🎉 (Ver [CHANGELOG.md](CHANGELOG.md))

## Descargas directas (v0.1.0)

Elige el instalador o paquete correspondiente a tu sistema operativo:

### 🐧 Linux (x86_64)

| Formato                 | Compatibilidad                                  | Descarga directa                                                                                                          |
| :---------------------- | :---------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| **AppImage** (Portable) | Universal (Debian, Fedora, Arch, Ubuntu 22.04+) | [📥 deskumi_0.1.0_amd64.AppImage](https://github.com/C-Rip/deskumi/releases/download/v0.1.0/deskumi_0.1.0_amd64.AppImage) |
| **.deb**                | Debian, Ubuntu, Linux Mint, Pop!_OS             | [📥 deskumi_0.1.0_amd64.deb](https://github.com/C-Rip/deskumi/releases/download/v0.1.0/deskumi_0.1.0_amd64.deb)           |
| **.rpm**                | Fedora, Nobara, openSUSE, RHEL                  | [📥 deskumi-0.1.0-1.x86_64.rpm](https://github.com/C-Rip/deskumi/releases/download/v0.1.0/deskumi-0.1.0-1.x86_64.rpm)     |

> **Nota para AppImage en Debian/Ubuntu:** Asegúrate de tener permisos de ejecución (`chmod +x deskumi_0.1.0_amd64.AppImage`). Si tu sistema no tiene `libfuse2`, instálalo con `sudo apt install libfuse2` o ejecuta con `./deskumi_...AppImage --appimage-extract-and-run`.

### 🪟 Windows (x64)

| Formato                        | Tipo                                           | Descarga directa                                                                                                        |
| :----------------------------- | :--------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| **Instalador estándar (.exe)** | Recomendado para la mayoría de usuarios (NSIS) | [📥 deskumi_0.1.0_x64-setup.exe](https://github.com/C-Rip/deskumi/releases/download/v0.1.0/deskumi_0.1.0_x64-setup.exe) |
| **Instalador MSI (.msi)**      | Instalador corporativo / despliegue WiX        | [📥 deskumi_0.1.0_x64_en-US.msi](https://github.com/C-Rip/deskumi/releases/download/v0.1.0/deskumi_0.1.0_x64_en-US.msi) |

Todos los binarios y sus firmas SHA-256 están disponibles en la [página de Releases](https://github.com/C-Rip/deskumi/releases/latest).

---

## Características (v0.1)

- Ventana transparente, sin bordes y siempre encima.
- Carga de avatares `.vrm` (VRoid, Booth, etc.).
- Animación idle, parpadeo, física de pelo/ropa (spring bones).
- La mirada sigue al cursor; arrastrar al personaje con el mouse.
- Click-through: los clics en zonas vacías pasan a las apps de abajo.
- Icono en bandeja, configuración persistente, bajo consumo de CPU/RAM.

## Stack

Tauri v2 (Rust) · Vite · TypeScript · Three.js · @pixiv/three-vrm

## Empezar

```bash
# 1. Activar hooks de git del repo
git config core.hooksPath .githooks

# 2. Verificar dependencias del sistema
bash .agents/skills/dev-environment/scripts/check-env.sh

# 3. (desde T-101) instalar y correr
npm install
npm run tauri dev
```

## Documentación

| Documento                                    | Para qué                               |
| -------------------------------------------- | -------------------------------------- |
| [AGENTS.md](AGENTS.md)                       | Reglas para agentes de IA y humanos    |
| [CONTRIBUTING.md](CONTRIBUTING.md)           | Flujo de git, commits, PRs             |
| [docs/ROADMAP.md](docs/ROADMAP.md)           | Plan de trabajo por fases e hitos      |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Diseño técnico y contrato IPC          |
| [docs/adr/](docs/adr/)                       | Decisiones de arquitectura             |
| [docs/tasks/](docs/tasks/)                   | Tarjetas de tareas para agentes        |
| [docs/QA.md](docs/QA.md)                     | Matriz de pruebas manuales por entorno |

## Licencia

MIT — ver [LICENSE](LICENSE). Los avatares de ejemplo tienen su propia licencia
(ver [assets/CREDITS.md](assets/CREDITS.md)).
