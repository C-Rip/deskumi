pub mod error;
pub mod input_region;
pub mod platform;
pub mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            tray::create_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform::get_platform_caps,
            input_region::set_input_region
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
