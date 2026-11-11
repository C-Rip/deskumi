# AGENTS.md — Reglas globales del proyecto Deskumi

> Este archivo es leído automáticamente por agentes de IA (Antigravity, Claude Code,
> Cursor, Codex, etc.). Es la **fuente de verdad** de cómo se trabaja en este repo.
> `CLAUDE.md` y `GEMINI.md` son symlinks a este archivo.

## Qué es este proyecto
App de escritorio multiplataforma (Linux primero, Windows después) que muestra
personajes 3D (VRM) y 2D interactivos sobre el escritorio, en una ventana
transparente, siempre encima, con click-through en las zonas vacías.

**Stack fijo (no cambiar sin un ADR aprobado):**
- Shell nativo: **Tauri v2** (Rust, edición 2021) — `src-tauri/`
- Frontend: **Vite + TypeScript (strict) + Three.js + @pixiv/three-vrm** — `src/`
- Sin frameworks de UI (React/Vue/etc.) en la ventana del personaje. Paneles de
  configuración futuros pueden usar una segunda ventana; requiere ADR.

## Antes de escribir código (obligatorio)
1. Lee [docs/ROADMAP.md](docs/ROADMAP.md) y la tarjeta de tu tarea en `docs/tasks/`.
2. Lee [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) y los ADR relevantes en `docs/adr/`.
3. Usa la skill `task-workflow` para reclamar la tarea y crear tu rama/worktree.
4. Si la tarea toca ventanas/transparencia/click-through en Linux, usa la skill
   `linux-overlay-troubleshooting`.

## Reglas duras
- **Una tarea = una rama = un PR hacia `dev`.** Nunca commits directos a `main` ni `dev`.
- `main` solo recibe merges desde `dev` cuando hay releases estables etiquetados.
- **Conventional Commits** obligatorios (ver skill `git-workflow`). El hook
  `.githooks/commit-msg` lo valida.
- **No inventes APIs.** Si no estás seguro de una firma de Tauri v2 / three-vrm,
  consulta la documentación oficial o el código en `node_modules` / `~/.cargo/registry`.
  Tauri v1 y v2 son incompatibles: ignora ejemplos de v1 (`tauri::Window` vs
  `WebviewWindow`, `allowlist` vs `capabilities`).
- **No agregues dependencias** (npm o crates) sin justificarlo en el PR. Peso del
  binario y RAM son requisitos de producto.
- **No subas modelos .vrm/.glb sin licencia verificada.** Registra cada asset en
  `assets/CREDITS.md`.
- **Nada de secretos** en el repo. Nada de rutas absolutas de tu máquina.
- **No rompas el contrato IPC** (`docs/ARCHITECTURE.md#contrato-ipc`) sin actualizarlo
  en el mismo PR.
- Si descubres algo que contradice la documentación: **actualiza la doc** en el
  mismo PR o abre un ADR. La doc desactualizada es un bug.

## Definition of Done (toda tarea)
- [ ] `npm run check` pasa (typecheck + lint + format + tests TS).
- [ ] `cargo fmt --check` y `cargo clippy -- -D warnings` pasan en `src-tauri/`.
- [ ] Probado manualmente con `npm run tauri dev` cuando hay cambios visibles;
      anotar entorno probado (distro / DE / X11 o Wayland / GPU) en el PR.
- [ ] Criterios de aceptación de la tarjeta cumplidos y marcados.
- [ ] Docs/ADR/CHANGELOG (`[Unreleased]`) actualizados si aplica.
- [ ] Sección "Handoff" de la tarjeta llenada para el siguiente agente.

## Comandos
| Acción | Comando |
| --- | --- |
| Verificar entorno | `bash .agents/skills/dev-environment/scripts/check-env.sh` |
| Desarrollo | `npm run tauri dev` |
| Chequeo completo | `npm run check && (cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings)` |
| Tests | `npm test` / `cd src-tauri && cargo test` |
| Build | `npm run tauri build` |

> Los scripts npm se crean en la tarea T-101. Hasta entonces, no existen.

## Convenciones de código
- Detalles por área en `.agents/rules/` (Rust/Tauri, Frontend/Three.js, docs).
- Idioma: **código, identificadores, commits y nombres de rama en inglés**.
  Documentación y comentarios explicativos largos pueden ir en español.
- Archivos pequeños y con una responsabilidad. Si un archivo pasa ~300 líneas, divídelo.

## Mapa del repo
```text
.agents/            rules/ y skills/ para agentes
.githooks/          hooks de git versionados (activar: git config core.hooksPath .githooks)
.github/            CI, plantillas de PR/issues
docs/               ROADMAP, ARCHITECTURE, ADRs, tarjetas de tareas, QA
src/                frontend (Three.js / VRM)          ← se crea en T-101
src-tauri/          backend Rust (Tauri v2)            ← se crea en T-101
assets/             modelos y animaciones con licencia ← ver CREDITS.md
```
