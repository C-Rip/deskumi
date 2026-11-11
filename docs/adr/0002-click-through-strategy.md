# ADR-0002: Estrategia de click-through

- **Estado:** aceptada
- **Fecha:** 2026-11-11
- **Autor(es):** crivera + @worker-103
- **Tarea relacionada:** T-103 (cierra con evidencia empírica), implementa en producción T-303

## Contexto

La ventana del personaje es significativamente más grande que el modelo 3D o sprite renderizado
(necesita espacio para animaciones, física de pelo/ropa, partículas y expresiones). Los clics en las
zonas transparentes deben llegar transparentemente al escritorio y aplicaciones de fondo; los clics sobre
el avatar deben ser capturados por Deskumi (arrastrar, interacciones, caricias, menú contextual).

`set_ignore_cursor_events(true)` en Tauri v2 hace **toda** la ventana transparente a la entrada. A diferencia
de Electron, WebKitGTK/Tauri **no reenvía `mousemove`** mientras se ignoran los eventos, por lo que una vez activado
el flag, el WebView no tiene forma interna de saber cuándo el puntero regresa a la silueta del personaje.

## Opciones consideradas

1. **Input region (recomendada a priori).** El frontend define la silueta del avatar (lote de rectángulos
   calculados por alpha picking o bounding boxes) y los envía a Rust (`set_input_region`).
   - Linux: `gtk::WidgetExt::input_shape_combine_region` sobre `gtk::ApplicationWindow` usando `cairo::Region`.
     Bajo X11/XWayland delega en la extensión XShape; bajo Wayland nativo delega en `wl_surface.set_input_region`.
   - Windows: `SetWindowRgn` o `WS_EX_LAYERED` + hit-test nativo (a implementar en F5).
   - Pros: Cero CPU en reposo (el hit-test lo resuelve el kernel/compositor), latencia cero, compatible nativamente con Wayland y X11/XWayland.
   - Contras: Requiere sincronización hilo principal GTK y throttle durante animaciones continuas (~10–15 Hz).

2. **Toggle por polling de cursor global.** Un hilo en Rust lee la posición global del cursor (`app.cursor_position()`)
   a 30–60 Hz, evalúa si cae dentro de la silueta y alterna `window.set_ignore_cursor_events(bool)`.
   - Pros: Utiliza API pública de Tauri sin llamadas FFI directas a GTK.
   - Contras: **Inviable en Wayland nativo** (el protocolo bloquea por diseño la lectura de coordenadas globales a clientes normales; Tao retorna `(0, 0)` estático). En X11 consume ciclos de CPU continuos por llamadas roundtrip `XQueryPointer`.

3. **Sin click-through parcial.** Ventana recortada al tamaño del avatar.
   - Descartada por cortar animaciones y limitar drásticamente la UX del producto.

## Decisión

**Se aprueba e implementa la Opción 1 (Input Region) como la arquitectura definitiva de click-through para Deskumi.**

La Opción 2 queda **descartada** como mecanismo general debido a que el protocolo Wayland prohíbe la consulta de posición global del cursor para clientes no privilegiados, resultando en `(0, 0)` invariable y haciendo imposible detectar el retorno del cursor al personaje.

## Evidencia empírica (Spike T-103)

### Entorno de prueba

- **SO:** Fedora Linux 44 (Workstation Edition), Kernel 6.13 x86_64
- **Compositor / DE:** GNOME 48.0 (Wayland Mutter / XWayland)
- **GPU:** Intel HD Graphics 630 (Kaby Lake-S GT2)
- **Librerías nativas:** WebKit2GTK 2.54.2, GTK 3.24.52, Cairo 1.18.6
- **Stack app:** Tauri v2.12.5 (tao 0.37.2, wry 0.57.2)

### Resultados de medición

| Métrica / Capacidad      | Opción 1: Input Region (XWayland)           | Opción 1: Input Region (Wayland nativo) | Opción 2: Polling Cursor (XWayland)     | Opción 2: Polling Cursor (Wayland nativo) |
| :----------------------- | :------------------------------------------ | :-------------------------------------- | :-------------------------------------- | :---------------------------------------- |
| **Soporte funcional**    | ✅ Funciona al 100%                         | ✅ Funciona al 100%                     | ⚠️ Funciona con lag (~16-33ms)          | ❌ **BLOQUEADO** (inviable)               |
| **Cursor global**        | N/A (no lo requiere)                        | N/A (no lo requiere)                    | ✅ Disponible vía GDK Seat              | ❌ Retorna `(0, 0)` fijo (Tao util.rs:19) |
| **Costo de aplicación**  | **1.55 – 4.53 µs** (1 a 100 rects)          | **1.66 – 4.15 µs** (1 a 100 rects)      | N/A                                     | N/A                                       |
| **Costo por consulta**   | N/A                                         | N/A                                     | 150.37 µs (30 Hz) / 223.71 µs (60 Hz)   | 12.52 µs (falla inmediata `(0,0)`)        |
| **CPU en reposo**        | **0.00%** (hit-test en kernel/compositor)   | **0.00%** (hit-test en compositor)      | **~0.45%** (30 Hz) / **~1.30%** (60 Hz) | N/A                                       |
| **Descomposición Cairo** | 1 rect → 1 banda; 5 → 9; 20 → 24; 100 → 104 | Idéntica (cairo banded regions)         | N/A                                     | N/A                                       |

### Hallazgos técnicos clave

1. **Wayland nativo:** `tao::platform_impl::linux::util::cursor_position` implementa explícitamente:

   ```rust
   if is_wayland {
       Ok((0, 0).into())
   } else { ... }
   ```

   No existe API ni extensión Wayland estándar sin privilegios para obtener el cursor fuera de la superficie enfocada. Cualquier intento de polling en Wayland es nulo.

2. **Input Region en GTK3 / Wayland:** `gtk_widget_input_shape_combine_region` traduce la llamada a `gdk_wayland_window_input_shape_combine_region`, la cual envía una petición `wl_surface.set_input_region` con la región Cairo descompuesta en rectángulos no superpuestos. El compositor Mutter/KWin realiza el filtrado de eventos de puntero sin activar la aplicación.

3. **Manejo de hilos:** Los widgets y ventanas GTK no implementan `Send`. La llamada a `input_shape_combine_region` debe ser despachada al hilo principal mediante `app_handle.run_on_main_thread(move || { ... })`. La obtención de `window.gtk_window()` debe ocurrir dentro del closure o antes de cruzar hilos.

4. **Escalado de coordenadas:** `cairo::RectangleInt` opera en coordenadas lógicas de GTK (las mismas coordenadas CSS que emite el frontend en su viewport). No se requiere multiplicación manual por `scale_factor` cuando el frontend envía píxeles lógicos de cliente.

## Snippet canónico de implementación (Rust)

```rust
use tauri::{AppHandle, WebviewWindow};

#[derive(serde::Deserialize, Clone, Copy)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[tauri::command]
pub fn set_input_region(
    window: WebviewWindow,
    rects: Option<Vec<Rect>>,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use gtk::traits::WidgetExt;
        let app = window.app_handle().clone();

        app.run_on_main_thread(move || {
            let gtk_window = match window.gtk_window() {
                Ok(w) => w,
                Err(e) => {
                    log::error!("Failed to obtain GTK window: {e}");
                    return;
                }
            };

            if let Some(rect_list) = rects {
                let region = cairo::Region::create();
                for r in rect_list {
                    let rect = cairo::RectangleInt::new(r.x, r.y, r.w, r.h);
                    let _ = region.union_rectangle(&rect);
                }
                gtk_window.input_shape_combine_region(Some(&region));
            } else {
                // None restaura la región interactiva a la ventana completa
                gtk_window.input_shape_combine_region(None);
            }
        }).map_err(|e| e.to_string())?;

        Ok(())
    }

    #[cfg(not(target_os = "linux"))]
    {
        // En Windows se implementará con SetWindowRgn en F5
        Ok(())
    }
}
```

## Consecuencias

- Se formaliza el comando IPC `set_input_region` en el contrato IPC (`docs/ARCHITECTURE.md`).
- Se crea la tarea **T-303** para implementar la integración en producción con el frontend, incluyendo throttling a 15 Hz para animaciones continuas.
- El backend Linux requiere dependencias `gtk = "0.18"` y `cairo-rs = "0.18"` bajo `target_os = "linux"`.
- Zero regresiones de rendimiento: al no requerir polling, Deskumi cumple el objetivo de < 5% de uso de CPU en reposo establecido en el Roadmap.
