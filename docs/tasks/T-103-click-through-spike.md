# T-103: Spike — estrategia de click-through

| Campo | Valor |
| --- | --- |
| Estado | lista |
| Asignado | — |
| Fase | F1 |
| Rama | `spike/T-103-click-through` |
| Depende de | T-101 (idealmente sobre T-102) |
| Estimación | L (time-box: 2 días) |
| Skills útiles | `linux-overlay-troubleshooting`, `adr` |

## Objetivo
Decidir con evidencia cómo hacer click-through parcial en cada entorno y cerrar
[ADR-0002](../adr/0002-click-through-strategy.md).

## Contexto
`set_ignore_cursor_events` de Tauri es todo-o-nada y no reenvía `mousemove`.
Hipótesis: aplicar una *input region* a la ventana GTK subyacente funciona en X11 y
Wayland. Acceso a la ventana GTK desde Tauri v2 en Linux: `WebviewWindow::gtk_window()`
(verificar firma en la versión instalada en `~/.cargo/registry`).

## Alcance
- Incluye: prototipo de **Opción 1** (input region con un rectángulo fijo, luego varios
  rectángulos) y **Opción 2** (polling de cursor + toggle), mediciones, matriz de
  resultados, ADR cerrado.
- **No incluye:** cálculo real de silueta del avatar (T-304), código pulido.
  El código del spike puede tirarse; lo que vale es el ADR.

## Pasos sugeridos
1. Comando `set_input_region(rects)` en Rust usando `gdk::Window::input_shape_combine_region`
   / `gtk::Widget::input_shape_combine_region` con un `cairo::Region`.
2. Probar región fija (rect central 200×200): clics fuera deben pasar a la app de abajo.
3. Probar en E1 (XWayland y Wayland nativo) y, si es posible, E2 (KDE).
4. Prototipo Opción 2: hilo Rust que lee cursor global (`cursor_position()` de Tauri)
   a 30 Hz y alterna `set_ignore_cursor_events`. Medir CPU.
5. Documentar en ADR-0002: tabla entorno × opción (funciona / no / con detalle),
   CPU medida, snippets clave. Actualizar matriz en ARCHITECTURE.md.

## Criterios de aceptación
- [ ] ADR-0002 en estado **aceptada** con evidencia por entorno.
- [ ] Matriz de capacidades de ARCHITECTURE.md actualizada con datos reales.
- [ ] Tarjeta T-303 creada con el plan de implementación definitivo.
- [ ] El PR del spike se mergea **solo** con docs (o con código detrás de un flag
      si se decide reutilizarlo).

## Verificación
Clic sobre el escritorio/otra ventana a través de la zona fuera de la región;
clic dentro de la región registra evento en la consola del WebView.

## Handoff
_Pendiente._
