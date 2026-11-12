pub mod error;
pub mod input_region;
pub mod platform;
pub mod settings_window;
pub mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            tray::create_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform::get_platform_caps,
            platform::set_window_desktop_position,
            input_region::set_input_region,
            settings_window::open_settings_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
