---
name: git-workflow
description: >-
  Flujo de git profesional del proyecto Deskumi: nombres de rama, Conventional
  Commits, worktrees para agentes en paralelo, rebase, PRs y releases. Usar al crear
  ramas, hacer commits, abrir PRs, resolver conflictos o etiquetar versiones.
---

# Git workflow

Resumen humano en [CONTRIBUTING.md](../../../CONTRIBUTING.md). Aquí: los pasos exactos.

## 0. Una vez por clon

```bash
git config core.hooksPath .githooks   # valida Conventional Commits
git config pull.rebase true
git config rebase.autoStash true
```

> **Commits firmados:** el usuario firma commits con su llave SSH (`commit.gpgsign`).
> Si `git commit` pide passphrase, **no** desactives la firma ni la saltes: pide al
> usuario que cargue la llave en el agente (`ssh-add ~/.ssh/id_ed25519`) y reintenta.

## 1. Empezar una tarea (worktree aislado)

Usa el script (crea rama desde `dev` actualizado y un worktree hermano):

```bash
bash .agents/skills/git-workflow/scripts/start-task.sh T-202 feat vrm-loader
# → ../deskumi-T-202  en rama feat/T-202-vrm-loader
```

Trabaja **solo** dentro de ese directorio. Si no hay remoto, el script usa `dev` local.

## 2. Commits

- Pequeños y atómicos; cada uno compila.
- Formato: `tipo(scope): resumen imperativo en inglés` + `Refs: T-XXX` en el cuerpo.
- Ejemplos válidos:
  - `feat(avatar): load VRM models with VRMLoaderPlugin`
  - `fix(window): disable DMABUF renderer to avoid black background`
  - `docs(adr): accept ADR-0002 input region strategy`
  - `feat(ipc)!: rename set_click_through payload` (rompe contrato)
- Nunca: `git commit -m "wip"`, `--no-verify`, commits con archivos generados
  (`target/`, `dist/`, `node_modules/`).

## 3. Mantenerse al día

```bash
git fetch origin && git rebase origin/dev   # o `git rebase dev` sin remoto
```

Conflictos en `package-lock.json`: acepta el de `dev` y vuelve a correr `npm install`.
Conflictos en `Cargo.lock`: acepta el de `dev` y corre `cargo build`.

## 4. Antes del PR

```bash
npm run check
(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)
git log --oneline dev..HEAD    # revisa que los mensajes sean limpios
```

Si hay commits basura, límpialos con `git rebase -i dev` (squash/fixup/reword).

## 5. Abrir PR

- Con GitHub CLI: `gh pr create --fill --base dev` y completa la plantilla.
- Sin remoto (solo local): deja la rama lista y reporta al coordinador; él hace
  `git merge --squash <rama>` en `dev`.
- Título del PR = mensaje del squash commit.

## 6. Después del merge

```bash
git worktree remove ../deskumi-T-202
git branch -d feat/T-202-vrm-loader
```

## 7. Releases (solo coordinador)

1. Mover `[Unreleased]` del CHANGELOG a `[X.Y.Z] - AAAA-MM-DD`.
2. Igualar versión en `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
3. PR de `dev` a `main` con squash o merge commit: `chore(release): vX.Y.Z` → `git tag -a vX.Y.Z -m "vX.Y.Z"` → push con tags.
