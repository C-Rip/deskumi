# Deskumi ✨

Personajes 3D (VRM) y 2D interactivos viviendo en tu escritorio — ligero, open source
y **Linux-first** (Fedora, Nobara, Debian; GNOME y KDE), con soporte Windows después.

> Estado: **Fase 0 — Bootstrap.** Aún no hay código; ver [docs/ROADMAP.md](docs/ROADMAP.md).

## Características objetivo (v0.1)
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
| Documento | Para qué |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Reglas para agentes de IA y humanos |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Flujo de git, commits, PRs |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Plan de trabajo por fases e hitos |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Diseño técnico y contrato IPC |
| [docs/adr/](docs/adr/) | Decisiones de arquitectura |
| [docs/tasks/](docs/tasks/) | Tarjetas de tareas para agentes |
| [docs/QA.md](docs/QA.md) | Matriz de pruebas manuales por entorno |

## Licencia
MIT — ver [LICENSE](LICENSE). Los avatares de ejemplo tienen su propia licencia
(ver [assets/CREDITS.md](assets/CREDITS.md)).
