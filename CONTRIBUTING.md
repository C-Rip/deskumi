# Contribuir a Deskumi

Aplica igual para humanos y agentes de IA. El detalle operativo está en la skill
[`git-workflow`](.agents/skills/git-workflow/SKILL.md).

## Modelo de ramas (Gitflow / Trunk híbrido con dev)

- `main` contiene el código estable de producción / releases. Solo entra código desde `dev` mediante release PRs y tags `v*`.
- `dev` es la rama de integración activa. Todos los PRs de tareas se abren hacia `dev`.
- Ramas cortas desde `dev`:

| Prefijo     | Uso                          | Ejemplo                     |
| ----------- | ---------------------------- | --------------------------- |
| `feat/`     | funcionalidad nueva          | `feat/T-202-vrm-loader`     |
| `fix/`      | corrección de bug            | `fix/T-310-black-bg-nvidia` |
| `spike/`    | experimento desechable       | `spike/T-103-click-through` |
| `docs/`     | solo documentación           | `docs/adr-0004-tray`        |
| `chore/`    | tooling, deps, CI            | `chore/T-104-ci`            |
| `refactor/` | sin cambio de comportamiento | `refactor/scene-loop`       |

Formato: `<tipo>/<ID-tarea>-<descripcion-kebab>`.

## Commits: Conventional Commits

```
<tipo>(<scope opcional>): <resumen en imperativo, inglés, ≤ 72 chars>

[cuerpo opcional: el porqué, no el qué]

Refs: T-202
```

Tipos: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
Scopes sugeridos: `window`, `ipc`, `render`, `avatar`, `anim`, `input`, `tray`, `config`, `build`, `agents`.
Cambio incompatible: `feat(ipc)!: ...` + `BREAKING CHANGE:` en el cuerpo.

Activa la validación local: `git config core.hooksPath .githooks`.

## Pull Requests

- Título = el commit de squash (Conventional Commit).
- Usa la plantilla [.github/pull_request_template.md](.github/pull_request_template.md).
- Un PR = una tarjeta de `docs/tasks/`. Si crece, divídelo.
- CI verde + checklist de Definition of Done ([AGENTS.md](AGENTS.md)) completo.

## Trabajo en paralelo con varios agentes

Cada agente trabaja en su **propio git worktree** para no pisarse:

```bash
git worktree add ../deskumi-T-202 -b feat/T-202-vrm-loader dev
```

Reglas para evitar conflictos:

1. Reclama la tarea en su tarjeta (`Estado: en progreso`, `Asignado: <agente>`) en tu rama.
2. Respeta las dependencias declaradas en la tarjeta (`Depende de`).
3. Archivos "calientes" (`package.json`, `Cargo.toml`, `tauri.conf.json`,
   `src/main.ts`, `src-tauri/src/lib.rs`): cambios mínimos y rebase frecuente.
4. Antes de abrir PR: `git fetch && git rebase origin/dev`.

## Protección de ramas en GitHub

Para mantener la estabilidad de `main` y `dev`, configurar Branch Protection Rules (o Rulesets) en el repositorio de GitHub:

1. **Ramas protegidas:** `main` y `dev`.
2. **Requerir Pull Request antes de fusionar:**
   - Exigir al menos 1 aprobación (review) para cambios hacia `main`.
   - Impedir commits y pushes directos (`Require a pull request before merging`).
3. **Requerir que los chequeos de estado pasen antes del merge (Status checks):**
   - Marcar como obligatorios (`Require status checks to pass before merging` y `Require branches to be up to date before merging`):
     - `pr-title` (en pull requests)
     - `frontend`
     - `rust`
     - `build-linux` (en `main`)
4. **No permitir saltarse las reglas:** aplicar estas restricciones también a administradores (`Do not allow bypassing the above settings`).

## Versionado y releases

- [SemVer](https://semver.org/lang/es/). Mientras sea `0.x`, cambios de minor pueden romper.
- Tags `vX.Y.Z` en `main`. [CHANGELOG.md](CHANGELOG.md) en formato
  [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
- La versión vive en `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`:
  deben coincidir.
