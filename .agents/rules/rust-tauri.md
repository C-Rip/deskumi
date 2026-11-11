---
trigger: model_decision
description: Convenciones de Rust y Tauri v2. Aplicar al crear o editar cualquier archivo en src-tauri/ (Rust, tauri.conf.json, capabilities).
---

# Reglas: Rust + Tauri v2 (`src-tauri/`)

## Tauri v2, no v1
- Tipos: `tauri::WebviewWindow`, `tauri::Manager`, `app.get_webview_window("main")`.
- Permisos con **capabilities** (`src-tauri/capabilities/*.json`), no `allowlist`.
- Plugins oficiales son crates `tauri-plugin-*` + paquete npm `@tauri-apps/plugin-*`;
  cada uno requiere permiso en capabilities.
- Ante la duda, lee el código fuente de la versión instalada en `~/.cargo/registry/src/`.

## Estructura
- `main.rs`: solo env vars de plataforma + `desktop_engine_lib::run()`.
- `lib.rs`: `tauri::Builder`, plugins, `invoke_handler`, `setup`.
- Un módulo por responsabilidad (`window.rs`, `cursor.rs`, `platform.rs`, `tray.rs`).
- Código específico de SO con `#[cfg(target_os = "linux")]` en funciones/módulos
  separados, nunca `if cfg!()` gigantes. Toda función con `cfg` debe tener una variante
  para los demás SO (aunque devuelva `Err` o no-op) para que compile en todos lados.

## Comandos IPC
- `#[tauri::command]` devuelven `Result<T, AppError>`; `AppError` implementa
  `serde::Serialize` (usar `thiserror`). Nada de `unwrap()`/`expect()` en comandos.
- Nombres en `snake_case`; payloads con `#[serde(rename_all = "camelCase")]` para que en
  TS sean `camelCase`.
- Cada comando nuevo: registrarlo en `invoke_handler`, documentarlo en la tabla
  "Contrato IPC" de `docs/ARCHITECTURE.md` y envolverlo en `src/platform/ipc.ts`.
- Operaciones de ventana desde comandos: usa la `WebviewWindow` inyectada como
  parámetro (`window: tauri::WebviewWindow`). Ten en cuenta que en Linux la API GTK
  debe usarse desde el hilo principal (`run_on_main_thread`).

## Calidad
- `cargo fmt` y `cargo clippy -- -D warnings` limpios.
- `unsafe` solo con comentario `// SAFETY:` explicando la invariante.
- Logs con `log`/`tauri-plugin-log`, no `println!` en código final.
- Tests unitarios para lógica pura (detección de plataforma, conversión de regiones).
