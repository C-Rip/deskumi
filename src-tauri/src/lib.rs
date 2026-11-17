use tauri::Manager;

pub mod cursor_bridge;
pub mod error;
pub mod input_region;
pub mod local_bridge;
pub mod platform;
pub mod settings_window;
pub mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(local_bridge::LocalBridgeState::new())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .setup(|app| {
            tray::create_tray(app.handle())?;
            cursor_bridge::init();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform::get_platform_caps,
            platform::set_window_desktop_position,
            platform::set_window_desktop_size,
            platform::get_window_cursor_position,
            platform::get_active_window_rect,
            input_region::set_input_region,
            settings_window::open_settings_window,
            local_bridge::start_local_bridge,
            local_bridge::stop_local_bridge,
            local_bridge::get_bridge_status,
            local_bridge::regenerate_bridge_token,
            local_bridge::subscribe_bridge_inbound,
            local_bridge::send_bridge_event
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            cursor_bridge::shutdown();
            if let Some(bridge) = app_handle.try_state::<local_bridge::LocalBridgeState>() {
                bridge.shutdown_sync();
            }
        }
    });
}
