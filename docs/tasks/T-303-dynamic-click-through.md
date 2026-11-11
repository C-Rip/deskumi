# T-303: Click-through dinámico en producción (Input Region)

| Campo         | Valor                                                          |
| ------------- | -------------------------------------------------------------- |
| Estado        | lista                                                          |
| Asignado      | —                                                              |
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

- [ ] Comando IPC `set_input_region` disponible y documentado en el contrato IPC.
- [ ] Soporte para regiones nulas (reset a ventana interactiva completa).
- [ ] Throttling en TypeScript implementado para evitar saturar el bridge IPC durante animaciones.
- [ ] `cargo check`, `cargo clippy -- -D warnings`, `cargo test` y `npm run check` pasan.
- [ ] Verificado en Linux XWayland y Wayland nativo.

## Archivos esperados

- `src-tauri/src/commands/input_region.rs` (o similar) — crear / modificar
- `src-tauri/Cargo.toml` — dependencias `gtk` y `cairo-rs` bajo target linux
- `src/platform/input-region.ts` — crear
- `docs/ARCHITECTURE.md` — contrato IPC actualizado si cambia

## Verificación

Llamar a `setInputRegion([{ x: 200, y: 200, w: 200, h: 200 }])`:

- Clics en (250, 250) son capturados por Deskumi.
- Clics en (50, 50) atraviesan la ventana transparente y hacen foco en la app inferior.

## Handoff

_Pendiente (lo llenará el agente que tome T-303)._
