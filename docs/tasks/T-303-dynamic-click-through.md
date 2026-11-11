# T-303: Click-through dinámico en producción (Input Region)

| Campo         | Valor                                                          |
| ------------- | -------------------------------------------------------------- |
| Estado        | hecha                                                          |
| Asignado      | @worker-303                                                    |
| Fase          | F3                                                             |
| Rama          | `feat/T-303-dynamic-click-through`                             |
| Depende de    | T-103, T-201                                                   |
| Estimación    | M (≤ 1 día)                                                    |
| Skills útiles | `linux-overlay-troubleshooting`, `task-workflow`, `rust-tauri` |

## Objetivo

Implementar de forma definitiva en producción la estrategia de click-through parcial
mediante **Input Region** en Linux (GTK3 + Cairo) y exponer el comando IPC
`set_input_region` hacia el frontend con soporte para throttling en animaciones.

## Contexto

- [ADR-0002](../adr/0002-click-through-strategy.md): Estrategia de click-through (Opción 1 aceptada con evidencia de T-103).
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md#contrato-ipc): Contrato IPC `set_input_region`.
- [linux-overlay-troubleshooting](../../.agents/skills/linux-overlay-troubleshooting/SKILL.md): Consideraciones de GTK en Wayland y XWayland.

## Alcance

- Incluye:
  - Comando IPC `set_input_region(rects: Option<Vec<Rect>>)` en backend Rust con ejecución en el hilo principal (`run_on_main_thread`).
  - Aplicación de `input_shape_combine_region` sobre `gtk::ApplicationWindow` usando `cairo::Region`.
  - Helper/servicio frontend en TypeScript `InputRegionManager` con limitador de frecuencia (throttling ~15 Hz) para actualizar la región solo cuando las coordenadas/bounding boxes cambien.
  - Manejo de reset de región a ventana completa (`rects = None`).
  - Tests unitarios en Rust (`cairo::Region` unions/contains).
- **No incluye:**
  - Cálculo de silueta por alpha picking (pertenece a T-304). T-303 expone la API y consume rectángulos calculados.
  - Implementación nativa de Windows (`SetWindowRgn` / `WS_EX_LAYERED`), que se abordará en F5.

## Pasos sugeridos

1. Crear módulo `src-tauri/src/commands/input_region.rs` (o integrar en módulo de ventana) con la firma IPC `set_input_region(window: WebviewWindow, rects: Option<Vec<Rect>>)`.
2. Validar que la ventana GTK subyacente (`window.gtk_window()`) reciba la región en el hilo principal.
3. Crear wrapper en frontend `src/platform/input-region.ts` con tipado estricto `Rect { x, y, w, h }` y función `setInputRegion(rects: Rect[] | null)`.
4. Añadir tests unitarios en Rust y Vitest.

## Criterios de aceptación

- [x] Comando IPC `set_input_region` disponible y documentado en el contrato IPC.
- [x] Soporte para regiones nulas (reset a ventana interactiva completa).
- [x] Throttling en TypeScript implementado para evitar saturar el bridge IPC durante animaciones.
- [x] `cargo check`, `cargo clippy -- -D warnings`, `cargo test` y `npm run check` pasan.
- [x] Verificado en Linux XWayland y Wayland nativo.

## Archivos esperados

- `src-tauri/src/input_region.rs` — creado e integrado en `lib.rs`
- `src-tauri/Cargo.toml` — dependencias `gtk` y `cairo-rs` bajo target linux, más `log`
- `src/platform/input-region.ts` y `src/platform/ipc.ts` — creados / actualizados
- `src/platform/input-region.test.ts` — suite de 22 tests unitarios en Vitest
- `docs/ARCHITECTURE.md` — contrato IPC actualizado con `set_input_region`

## Verificación

Llamar a `setInputRegion([{ x: 200, y: 200, w: 200, h: 200 }])`:

- Clics en (250, 250) son capturados por Deskumi.
- Clics en (50, 50) atraviesan la ventana transparente y hacen foco en la app inferior.

## Handoff

- **Implementación Rust (`src-tauri/src/input_region.rs`):**
  - Comando `set_input_region(window: WebviewWindow, rects: Option<Vec<Rect>>)`.
  - En Linux, despacha al hilo principal GTK vía `app.run_on_main_thread`.
  - Evita deadlocks de canales síncronos en Tauri accediendo a `gtk::Window::list_toplevels()` y propagando recursivamente (`apply_region_to_hierarchy`) la región Cairo a widgets y superficies hijas GDK.
  - Construye `cairo::Region` mediante `build_cairo_region(rects)` uniendo rectángulos válidos (`w > 0 && h > 0`).
  - Restaura forma completa al recibir `None`.
  - En otros SOs (`#[cfg(not(target_os = "linux"))]`), implementa no-op seguro que compila limpiamente (SetWindowRgn para Windows planificado en F5).
  - Incluye 6 tests unitarios en Rust probando construcción de región cairo, unions disjuntas y solapadas, dimensiones no positivas y serialización camelCase.
- **Implementación Frontend (`src/platform/input-region.ts`):**
  - Tipado estricto `Rect { x, y, w, h }`.
  - Servicio `InputRegionManager` con limitador configurable (~15 Hz por defecto), deduplicación de rectángulos idénticos (`areRectsEqual`), soporte para `setRegion`, `setImmediate`, `reset`, `flush` y `dispose`.
  - Cálculo de silueta por segmentos anatómicos VRM `calculateAvatarSegmentRects` (cabeza, torso, brazos, piernas) con fallback a `calculateScreenBoundingBox`.
  - Subsistema de motor `AvatarInputRegionSystem` registrado en `src/main.ts` que sincroniza dinámicamente las regiones interactivas con la ventana.
  - Previene menú contextual WebKit con `contextmenu` listener en `src/main.ts`.
  - 22 tests unitarios en Vitest con 100% de cobertura.
- **Siguiente paso:** T-304 (hit-test por silueta exacta / alpha picking o rejilla de micro-rectángulos para contorno perfecto pixel a pixel).
