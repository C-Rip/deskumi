// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
fn apply_linux_workarounds() {
    let mut applied = Vec::new();

    // ADR-0003: XWayland por defecto en Linux a menos que DESKUMI_WAYLAND=1 esté presente
    let deskumi_wayland = std::env::var("DESKUMI_WAYLAND")
        .map(|v| v == "1")
        .unwrap_or(false);

    if !deskumi_wayland && std::env::var("GDK_BACKEND").is_err() {
        std::env::set_var("GDK_BACKEND", "x11");
        applied.push("GDK_BACKEND=x11");
    }

    // Workaround para prevenir fondo negro con WebKitGTK y aceleración DMABUF
    if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        applied.push("WEBKIT_DISABLE_DMABUF_RENDERER=1");
    }

    if applied.is_empty() {
        eprintln!(
            "[deskumi] Linux workarounds: none applied (environment already set or DESKUMI_WAYLAND=1)"
        );
    } else {
        eprintln!(
            "[deskumi] Linux workarounds applied: {}",
            applied.join(", ")
        );
    }
}

#[cfg(not(target_os = "linux"))]
fn apply_linux_workarounds() {}

fn main() {
    apply_linux_workarounds();
    deskumi_lib::run();
}
