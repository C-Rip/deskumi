use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::error::AppError;

pub const TRAY_ID: &str = "deskumi-main-tray";
pub const MENU_TOGGLE_VISIBILITY: &str = "tray_toggle_visibility";
pub const MENU_QUIT: &str = "tray_quit";

pub fn create_tray(app: &AppHandle) -> Result<(), AppError> {
    let toggle_item =
        MenuItem::with_id(app, MENU_TOGGLE_VISIBILITY, "Ocultar / Mostrar", true, None::<&str>)
            .map_err(|e| AppError::Platform(format!("Failed to create tray toggle item: {e}")))?;

    let quit_item = MenuItem::with_id(app, MENU_QUIT, "Salir de Deskumi", true, None::<&str>)
        .map_err(|e| AppError::Platform(format!("Failed to create tray quit item: {e}")))?;

    let menu = Menu::with_items(app, &[&toggle_item, &quit_item])
        .map_err(|e| AppError::Platform(format!("Failed to create tray menu: {e}")))?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Deskumi");

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder
        .on_menu_event(move |app: &AppHandle<Wry>, event| match event.id.as_ref() {
            MENU_TOGGLE_VISIBILITY => {
                toggle_main_window_visibility(app);
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
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    }
}
