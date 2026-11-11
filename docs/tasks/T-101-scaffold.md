# T-101: Scaffold Tauri v2 + Vite + TypeScript + tooling

| Campo         | Valor                                              |
| ------------- | -------------------------------------------------- |
| Estado        | en_revision                                        |
| Asignado      | Antigravity                                        |
| Fase          | F1                                                 |
| Rama          | `chore/T-101-scaffold`                             |
| Depende de    | —                                                  |
| Estimación    | M                                                  |
| Skills útiles | `dev-environment`, `task-workflow`, `git-workflow` |

## Objetivo

Dejar un proyecto Tauri v2 que compila y abre una ventana, con el tooling de calidad
listo para que el resto de agentes trabaje sobre una base consistente.

## Contexto

- [ADR-0001](../adr/0001-tauri-v2-threejs-vrm.md), [ARCHITECTURE](../ARCHITECTURE.md#estructura-objetivo).
- En Fedora falta `webkit2gtk4.1-devel` (verificado 2026-11-11). Correr `check-env.sh`.

## Alcance

- Incluye: scaffold, estructura de carpetas vacía, tooling, scripts npm, `.vscode` recomendado.
- **No incluye:** transparencia (T-102), Three.js real (T-201), CI (T-104).

## Pasos sugeridos

1. Instalar deps de sistema (skill `dev-environment`).
2. Generar con `npm create tauri-app@latest` (template **vanilla-ts**, gestor **npm**,
   identificador `dev.crivera.deskumi`) en un directorio temporal y mover el
   contenido a la raíz del repo **sin sobrescribir** `README.md`, `.gitignore`, etc.
   (fusionar `.gitignore`).
3. Crear la estructura `src/engine/`, `src/platform/`, `src/styles/` según ARCHITECTURE.
   Separar `src-tauri/src/main.rs` (solo llama a `deskumi_lib::run()`) y `lib.rs`.
4. Tooling frontend: `typescript` en modo `strict`, ESLint (flat config + typescript-eslint),
   Prettier, Vitest. Instalar `three`, `@types/three`, `@pixiv/three-vrm` (todavía sin usar).
5. Scripts npm:
   - `dev`, `build`, `tauri`
   - `typecheck` → `tsc --noEmit`
   - `lint` → `eslint .`
   - `format` / `format:check` → Prettier
   - `test` → `vitest run`
   - `check` → typecheck + lint + format:check + test
6. Rust: `rustfmt.toml` (edition 2021), confirmar `cargo clippy -- -D warnings` limpio.
7. Igualar versión `0.1.0` en `package.json`, `Cargo.toml`, `tauri.conf.json`.
8. Un test trivial en Vitest y uno en Rust para que los pipelines tengan algo que correr.

## Criterios de aceptación

- [x] `npm run tauri dev` compila y ejecuta en E1 (Fedora GNOME).
- [x] `npm run check` pasa (typecheck, eslint, prettier, vitest).
- [x] `cargo fmt --check && cargo clippy -- -D warnings && cargo test` pasan en `src-tauri/`.
- [x] Estructura de carpetas coincide con ARCHITECTURE (src/engine, src/platform, src/styles).
- [x] Sección "Comandos" de `AGENTS.md` verificada/actualizada.

## Archivos esperados

- `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`,
  `eslint.config.js`, `.prettierrc`, `index.html`
- `src/main.ts`, `src/styles/app.css`, `src/engine/.gitkeep`, `src/platform/.gitkeep`
- `src-tauri/**` (Cargo.toml, tauri.conf.json, capabilities/default.json, src/main.rs, src/lib.rs, icons/)

## Verificación

```bash
npm ci && npm run check
(cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test)
```

## Handoff

- Scaffold completo de Tauri v2 (`deskumi_lib` y `deskumi` v0.1.0) con edición Rust 2021.
- Frontend con Vite 6, TypeScript estricto, Three.js 0.174 y @pixiv/three-vrm 3.3.7 instalados.
- Suite de calidad operativa (`npm run check` corre typecheck, eslint 9 flat config, prettier y vitest).
- Backend Rust verificado con clippy estricto (`-D warnings`) y tests unitarios listos.
- Listo para arrancar en paralelo T-102 (ventana transparente), T-103 (spike click-through) y T-104 (CI).
