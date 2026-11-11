use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OsType {
    Linux,
    Windows,
    Macos,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DisplayServer {
    X11,
    Xwayland,
    Wayland,
    Win32,
    Quartz,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCaps {
    pub os: OsType,
    pub display_server: DisplayServer,
    pub global_cursor: bool,
    pub input_region: bool,
    pub always_on_top: bool,
    pub set_position: bool,
}

pub fn detect_display_server_from_env(
    gdk_backend: Option<&str>,
    wayland_display: Option<&str>,
    xdg_session_type: Option<&str>,
) -> DisplayServer {
    let is_wayland_session = wayland_display.is_some_and(|s| !s.is_empty())
        || xdg_session_type.is_some_and(|s| s.eq_ignore_ascii_case("wayland"));

    if let Some(backend) = gdk_backend {
        let backend_lower = backend.to_lowercase();
        if backend_lower.contains("wayland") {
            return DisplayServer::Wayland;
        }
        if backend_lower.contains("x11") {
            return if is_wayland_session {
                DisplayServer::Xwayland
            } else {
                DisplayServer::X11
            };
        }
    }

    if is_wayland_session {
        DisplayServer::Wayland
    } else {
        DisplayServer::X11
    }
}

#[cfg(target_os = "linux")]
pub fn get_caps() -> PlatformCaps {
    let gdk_backend = std::env::var("GDK_BACKEND").ok();
    let wayland_display = std::env::var("WAYLAND_DISPLAY").ok();
    let xdg_session_type = std::env::var("XDG_SESSION_TYPE").ok();

    let display_server = detect_display_server_from_env(
        gdk_backend.as_deref(),
        wayland_display.as_deref(),
        xdg_session_type.as_deref(),
    );

    match display_server {
        DisplayServer::X11 | DisplayServer::Xwayland => PlatformCaps {
            os: OsType::Linux,
            display_server,
            global_cursor: true,
            input_region: true,
            always_on_top: true,
            set_position: true,
        },
        DisplayServer::Wayland => PlatformCaps {
            os: OsType::Linux,
            display_server,
            global_cursor: false,
            input_region: true,
            always_on_top: false,
            set_position: false,
        },
        DisplayServer::Win32 | DisplayServer::Quartz => unreachable!(),
    }
}

#[cfg(target_os = "windows")]
pub fn get_caps() -> PlatformCaps {
    PlatformCaps {
        os: OsType::Windows,
        display_server: DisplayServer::Win32,
        global_cursor: true,
        input_region: false,
        always_on_top: true,
        set_position: true,
    }
}

#[cfg(target_os = "macos")]
pub fn get_caps() -> PlatformCaps {
    PlatformCaps {
        os: OsType::Macos,
        display_server: DisplayServer::Quartz,
        global_cursor: true,
        input_region: false,
        always_on_top: true,
        set_position: true,
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
pub fn get_caps() -> PlatformCaps {
    PlatformCaps {
        os: OsType::Linux,
        display_server: DisplayServer::X11,
        global_cursor: false,
        input_region: false,
        always_on_top: false,
        set_position: false,
    }
}

#[tauri::command]
pub fn get_platform_caps() -> Result<PlatformCaps, AppError> {
    Ok(get_caps())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_display_server_xwayland() {
        let server =
            detect_display_server_from_env(Some("x11"), Some("wayland-0"), Some("wayland"));
        assert_eq!(server, DisplayServer::Xwayland);
    }

    #[test]
    fn test_detect_display_server_pure_x11() {
        let server = detect_display_server_from_env(Some("x11"), None, Some("x11"));
        assert_eq!(server, DisplayServer::X11);
    }

    #[test]
    fn test_detect_display_server_native_wayland_implicit() {
        let server = detect_display_server_from_env(None, Some("wayland-0"), Some("wayland"));
        assert_eq!(server, DisplayServer::Wayland);
    }

    #[test]
    fn test_detect_display_server_native_wayland_explicit() {
        let server =
            detect_display_server_from_env(Some("wayland"), Some("wayland-0"), Some("wayland"));
        assert_eq!(server, DisplayServer::Wayland);
    }

    #[test]
    fn test_serialization_matches_camel_case() {
        let caps = PlatformCaps {
            os: OsType::Linux,
            display_server: DisplayServer::Xwayland,
            global_cursor: true,
            input_region: true,
            always_on_top: true,
            set_position: true,
        };
        let json = serde_json::to_string(&caps).expect("serialization failed");
        assert!(json.contains("\"displayServer\":\"xwayland\""));
        assert!(json.contains("\"globalCursor\":true"));
        assert!(json.contains("\"inputRegion\":true"));
        assert!(json.contains("\"alwaysOnTop\":true"));
        assert!(json.contains("\"setPosition\":true"));
        assert!(json.contains("\"os\":\"linux\""));
    }
}
