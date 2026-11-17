use tauri::Manager;

pub mod cursor_bridge;
pub mod error;
pub mod input_region;
pub mod local_bridge;
pub mod platform;
pub mod plugins;
pub mod settings_window;
pub mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(local_bridge::LocalBridgeState::new())
        .manage(plugins::PluginState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .register_uri_scheme_protocol("plugin", |ctx, request| {
            plugins::handle_plugin_protocol(ctx.app_handle(), request)
        })
        .setup(|app| {
            tray::create_tray(app.handle())?;
            cursor_bridge::attach_app_handle(app.handle().clone());
            cursor_bridge::init();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform::get_platform_caps,
            platform::set_window_desktop_position,
            platform::set_window_desktop_size,
            platform::get_window_cursor_position,
            platform::get_active_window_rect,
            cursor_bridge::set_focus_metadata_mode,
            cursor_bridge::get_window_focus_metadata,
            input_region::set_input_region,
            settings_window::open_settings_window,
            local_bridge::start_local_bridge,
            local_bridge::stop_local_bridge,
            local_bridge::get_bridge_status,
            local_bridge::regenerate_bridge_token,
            local_bridge::subscribe_bridge_inbound,
            local_bridge::send_bridge_event,
            plugins::list_plugins,
            plugins::list_registered_animations,
            plugins::register_animation,
            plugins::unregister_animation,
            plugins::read_registered_animation_bytes
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
