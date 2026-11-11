# T-401: System Tray Icon y Menú Nativo

| Campo         | Valor                                                                 |
| ------------- | --------------------------------------------------------------------- |
| Estado        | en curso                                                              |
| Asignado      | @crivera + antigravity                                                |
| Fase          | F4                                                                    |
| Rama          | `feat/T-401-system-tray`                                              |
| Depende de    | T-303, T-304                                                          |
| Estimación    | M (≤ 1 día)                                                           |
| Skills útiles | `rust-tauri`, `task-workflow`                                         |

## Objetivo

Implementar el icono en la bandeja del sistema (System Tray / AppIndicator) con menú nativo en Tauri v2. El menú debe permitir al usuario:
1. **Mostrar / Ocultar** al avatar.
2. **Bloquear / Desbloquear Click-Through** (modo interactivo completo vs modo fantasma).
3. **Salir de Deskumi** limpiamente cerrando todos los recursos.

## Contexto

- [docs/ROADMAP.md](../ROADMAP.md): Fase 4 (T-401).
- En Linux (GNOME con AppIndicator / KDE / Wayland/X11), una aplicación de escritorio flotante sin bordes ni barra de título necesita imperativamente un icono en la barra de tareas/tray para que el usuario pueda recuperarla si se pierde o cerrarla sin recurrir a la terminal (`kill` / `Ctrl+C`).
- Tauri v2 incluye APIs nativas para Tray (`tauri::tray::TrayIconBuilder`) y Menús (`tauri::menu::MenuBuilder`).

## Alcance

- Incluye:
  - Creación y registro del Tray Icon con icono de la aplicación (`src-tauri/icons/32x32.png` / `icon.png`).
  - Menú nativo con opciones:
    - "Mostrar / Ocultar Deskumi" (toggle de visibilidad de la ventana).
    - "Click-Through desactivado" (checkbox / toggle para bloquear el traspaso de clics y capturar toda la ventana si el usuario lo desea).
    - Separador.
    - "Salir" (`app.exit(0)`).
  - Comunicación bidireccional si es necesario (eventos de ventana o estado global de click-through).
  - Pruebas y compilación limpia con `cargo clippy`.
- **No incluye:**
  - Ventana secundaria de ajustes/settings (pertenece a T-407).
  - Persistencia de configuración en disco (pertenece a T-402).

## Criterios de aceptación

- [ ] Aparece el icono de Deskumi en la bandeja del sistema (System Tray).
- [ ] Hacer clic en el icono o abrir su menú despliega las opciones nativas.
- [ ] "Ocultar / Mostrar" alterna la visibilidad de la ventana del avatar de forma instantánea.
- [ ] "Salir" cierra la aplicación limpiamente.
- [ ] `cargo clippy` y `cargo test` pasan sin advertencias.

## Archivos esperados

- `src-tauri/src/tray.rs` — inicialización del tray y callbacks del menú
- `src-tauri/src/lib.rs` — registro del tray en el builder de Tauri
- `docs/tasks/T-401-system-tray.md` — tarjeta de tarea

## Handoff

_Pendiente al completar la implementación._
