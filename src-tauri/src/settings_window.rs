use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::error::AppError;

pub const SETTINGS_WINDOW_LABEL: &str = "settings";
pub const SETTINGS_WINDOW_TITLE: &str = "Ajustes de Deskumi";
pub const SETTINGS_WINDOW_URL: &str = "settings.html";
pub const SETTINGS_WINDOW_WIDTH: f64 = 460.0;
pub const SETTINGS_WINDOW_HEIGHT: f64 = 540.0;

#[tauri::command]
pub fn open_settings_window(app: AppHandle) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("settings-window-visibility", true);
        return Ok(());
    }

    let app_clone = app.clone();
    let window = WebviewWindowBuilder::new(
        &app,
        SETTINGS_WINDOW_LABEL,
        WebviewUrl::App(SETTINGS_WINDOW_URL.into()),
    )
    .title(SETTINGS_WINDOW_TITLE)
    .inner_size(SETTINGS_WINDOW_WIDTH, SETTINGS_WINDOW_HEIGHT)
    .resizable(false)
    .decorations(true)
    .transparent(false)
    .center()
    .build()
    .map_err(|e| AppError::Platform(format!("Failed to build settings window: {e}")))?;

    // Notify frontend that settings window is opened/active
    let _ = app.emit("settings-window-visibility", true);

    let app_for_events = app_clone.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            let _ = app_for_events.emit("settings-window-visibility", false);
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_settings_window_constants() {
        assert_eq!(SETTINGS_WINDOW_LABEL, "settings");
        assert_eq!(SETTINGS_WINDOW_TITLE, "Ajustes de Deskumi");
        assert_eq!(SETTINGS_WINDOW_URL, "settings.html");
        assert!((SETTINGS_WINDOW_WIDTH - 460.0).abs() < f64::EPSILON);
        assert!((SETTINGS_WINDOW_HEIGHT - 540.0).abs() < f64::EPSILON);
    }
}
