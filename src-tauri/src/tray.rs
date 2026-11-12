use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::error::AppError;

pub const TRAY_ID: &str = "deskumi-main-tray";
pub const MENU_TOGGLE_VISIBILITY: &str = "tray_toggle_visibility";
pub const MENU_LOAD_AVATAR: &str = "tray_load_avatar";
pub const MENU_CLEAR_AVATAR: &str = "tray_clear_avatar";
pub const MENU_QUIT: &str = "tray_quit";

pub fn create_tray(app: &AppHandle) -> Result<(), AppError> {
    let toggle_item =
        MenuItem::with_id(app, MENU_TOGGLE_VISIBILITY, "Ocultar / Mostrar", true, None::<&str>)
            .map_err(|e| AppError::Platform(format!("Failed to create tray toggle item: {e}")))?;

    let load_avatar_item = MenuItem::with_id(
        app,
        MENU_LOAD_AVATAR,
        "Cargar avatar (.vrm)...",
        true,
        None::<&str>,
    )
    .map_err(|e| AppError::Platform(format!("Failed to create tray load avatar item: {e}")))?;

    let clear_avatar_item = MenuItem::with_id(
        app,
        MENU_CLEAR_AVATAR,
        "Quitar avatar",
        true,
        None::<&str>,
    )
    .map_err(|e| AppError::Platform(format!("Failed to create tray clear avatar item: {e}")))?;

    let quit_item = MenuItem::with_id(app, MENU_QUIT, "Salir de Deskumi", true, None::<&str>)
        .map_err(|e| AppError::Platform(format!("Failed to create tray quit item: {e}")))?;

    let menu = Menu::with_items(app, &[&toggle_item, &load_avatar_item, &clear_avatar_item, &quit_item])
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
            if is_visible {
                let _ = window.hide();
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
            }
        }
    }
}
