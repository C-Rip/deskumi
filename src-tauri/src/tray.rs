use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::error::AppError;

pub const TRAY_ID: &str = "deskumi-main-tray";
pub const MENU_TOGGLE_VISIBILITY: &str = "tray_toggle_visibility";
pub const MENU_LOAD_AVATAR: &str = "tray_load_avatar";
pub const MENU_CLEAR_AVATAR: &str = "tray_clear_avatar";
pub const MENU_LOAD_VRMA: &str = "tray_load_vrma";
pub const MENU_STOP_VRMA: &str = "tray_stop_vrma";
pub const MENU_TOGGLE_AUTOSTART: &str = "tray_toggle_autostart";
pub const MENU_QUIT: &str = "tray_quit";

pub fn create_tray(app: &AppHandle) -> Result<(), AppError> {
    let toggle_item = MenuItem::with_id(
        app,
        MENU_TOGGLE_VISIBILITY,
        "Ocultar / Mostrar",
        true,
        None::<&str>,
    )
    .map_err(|e| AppError::Platform(format!("Failed to create tray toggle item: {e}")))?;

    let load_avatar_item = MenuItem::with_id(
        app,
        MENU_LOAD_AVATAR,
        "Cargar avatar (.vrm)...",
        true,
        None::<&str>,
    )
    .map_err(|e| AppError::Platform(format!("Failed to create tray load avatar item: {e}")))?;

    let clear_avatar_item =
        MenuItem::with_id(app, MENU_CLEAR_AVATAR, "Quitar avatar", true, None::<&str>).map_err(
            |e| AppError::Platform(format!("Failed to create tray clear avatar item: {e}")),
        )?;
    let load_vrma_item = MenuItem::with_id(
        app,
        MENU_LOAD_VRMA,
        "Cargar animación (.vrma)...",
        true,
        None::<&str>,
    )
    .map_err(|e| AppError::Platform(format!("Failed to create tray load vrma item: {e}")))?;

    let stop_vrma_item = MenuItem::with_id(
        app,
        MENU_STOP_VRMA,
        "Detener animación (.vrma)",
        true,
        None::<&str>,
    )
    .map_err(|e| AppError::Platform(format!("Failed to create tray stop vrma item: {e}")))?;

    let initial_autostart = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart_item = CheckMenuItem::with_id(
        app,
        MENU_TOGGLE_AUTOSTART,
        "Iniciar con el sistema",
        true,
        initial_autostart,
        None::<&str>,
    )
    .map_err(|e| AppError::Platform(format!("Failed to create tray autostart item: {e}")))?;

    let quit_item = MenuItem::with_id(app, MENU_QUIT, "Salir de Deskumi", true, None::<&str>)
        .map_err(|e| AppError::Platform(format!("Failed to create tray quit item: {e}")))?;

    let menu = Menu::with_items(
        app,
        &[
            &toggle_item,
            &load_avatar_item,
            &clear_avatar_item,
            &load_vrma_item,
            &stop_vrma_item,
            &autostart_item,
            &quit_item,
        ],
    )
    .map_err(|e| AppError::Platform(format!("Failed to create tray menu: {e}")))?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Deskumi");

    let icon = app.default_window_icon().cloned().unwrap_or_else(|| {
        tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
            .expect("Failed to load embedded tray icon 32x32.png")
    });
    builder = builder.icon(icon);

    let autostart_item_for_event = autostart_item.clone();

    builder
        .on_menu_event(move |app: &AppHandle<Wry>, event| match event.id.as_ref() {
            MENU_TOGGLE_VISIBILITY => {
                toggle_main_window_visibility(app);
            }
            MENU_LOAD_AVATAR => {
                use tauri::Emitter;
                let _ = app.emit("tray-request-load-avatar", ());
            }
            MENU_CLEAR_AVATAR => {
                use tauri::Emitter;
                let _ = app.emit("tray-request-clear-avatar", ());
            }
            MENU_LOAD_VRMA => {
                use tauri::Emitter;
                let _ = app.emit("tray-request-load-vrma", ());
            }
            MENU_STOP_VRMA => {
                use tauri::Emitter;
                let _ = app.emit("tray-request-stop-vrma", ());
            }
            MENU_TOGGLE_AUTOSTART => {
                use tauri::Emitter;
                let autolaunch = app.autolaunch();
                let currently_enabled = autolaunch.is_enabled().unwrap_or(false);
                let target_enabled = !currently_enabled;
                let result = if target_enabled {
                    autolaunch.enable()
                } else {
                    autolaunch.disable()
                };

                let final_enabled = match result {
                    Ok(()) => target_enabled,
                    Err(err) => {
                        log::warn!("Failed to toggle autostart: {err}");
                        autolaunch.is_enabled().unwrap_or(currently_enabled)
                    }
                };

                let _ = autostart_item_for_event.set_checked(final_enabled);
                let _ = app.emit("tray-autostart-changed", final_enabled);
            }
            }
            MENU_QUIT => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                toggle_main_window_visibility(app);
            }
        })
        .build(app)
        .map_err(|e| AppError::Platform(format!("Failed to build tray icon: {e}")))?;

    Ok(())
}

pub fn toggle_main_window_visibility(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(is_visible) = window.is_visible() {
            use tauri::Emitter;
            if is_visible {
                let _ = window.hide();
                let _ = app.emit("tray-visibility-changed", false);
            } else {
                // When unhiding, explicitly restore position if it was shifted by the window manager
                if let Ok(pos) = window.outer_position() {
                    let _ = window.set_position(tauri::Position::Physical(pos));
                }
                let _ = window.show();
                let _ = window.set_always_on_top(true);
                #[cfg(target_os = "linux")]
                {
                    use gtk::glib::Cast;
                    use gtk::traits::GtkWindowExt;
                    let app_handle = app.clone();
                    let _ = app_handle.run_on_main_thread(move || {
                        for widget in gtk::Window::list_toplevels() {
                            if let Some(win) = widget.dynamic_cast_ref::<gtk::Window>() {
                                win.set_keep_above(true);
                            }
                        }
                    });
                }
                let _ = window.set_focus();
                let _ = app.emit("tray-visibility-changed", true);
            }
        }
    }
}
