//! Multi-compositor Wayland global cursor bridge (`org.deskumi.CursorBridge`).
//!
//! On Wayland compositors (KDE KWin, GNOME Mutter), XWayland and Wayland clients
//! stop receiving global pointer coordinates when the cursor enters native
//! Wayland surfaces or click-through transparent regions.
//!
//! This module exposes a session D-Bus endpoint (`org.deskumi.CursorBridge`)
//! with `ReportNormalizedCursor(relX: f64, relY: f64)` relative to the `"Deskumi"`
//! window geometry, and on KDE Plasma (KWin 6) automatically loads a lightweight
//! KWin Script using `workspace.cursorPosChanged` + `callDBus`.

use std::sync::Mutex;
use std::time::{Duration, Instant};

const CURSOR_SAMPLE_TTL: Duration = Duration::from_secs(10);
const WINDOW_SAMPLE_TTL: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy)]
struct CursorSample {
    rel_x: f64,
    rel_y: f64,
    updated_at: Instant,
}

#[derive(Debug, Clone, Copy)]
struct ActiveWindowSample {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    deskumi_width: f64,
    updated_at: Instant,
}

static LATEST_CURSOR: Mutex<Option<CursorSample>> = Mutex::new(None);
static LATEST_ACTIVE_WINDOW: Mutex<Option<ActiveWindowSample>> = Mutex::new(None);

/// Stores a normalized cursor coordinate relative to the `"Deskumi"` window.
pub fn update_normalized_cursor(rel_x: f64, rel_y: f64) {
    if !rel_x.is_finite() || !rel_y.is_finite() {
        return;
    }
    if let Ok(mut guard) = LATEST_CURSOR.lock() {
        *guard = Some(CursorSample {
            rel_x,
            rel_y,
            updated_at: Instant::now(),
        });
    }
}

/// Converts normalized window-relative coordinates `(rel_x, rel_y)` into
/// window-local pixel coordinates for a window of `(width, height)`.
pub fn normalized_to_pixel(rel_x: f64, rel_y: f64, width: i32, height: i32) -> Option<(i32, i32)> {
    if !rel_x.is_finite() || !rel_y.is_finite() || width <= 0 || height <= 0 {
        return None;
    }
    let px = (rel_x * f64::from(width)).round() as i32;
    let py = (rel_y * f64::from(height)).round() as i32;
    Some((px, py))
}

/// Returns the latest bridged cursor position scaled to `(width, height)` if
/// a fresh sample was received within [`CURSOR_SAMPLE_TTL`].
pub fn latest_pixel_cursor(width: i32, height: i32) -> Option<(i32, i32)> {
    let sample = LATEST_CURSOR.lock().ok().and_then(|guard| *guard)?;
    if sample.updated_at.elapsed() > CURSOR_SAMPLE_TTL {
        return None;
    }
    normalized_to_pixel(sample.rel_x, sample.rel_y, width, height)
}

/// Stores the active desktop window geometry reported by the compositor bridge.
pub fn update_active_window(x: f64, y: f64, width: f64, height: f64, deskumi_width: f64) {
    if !x.is_finite()
        || !y.is_finite()
        || !width.is_finite()
        || !height.is_finite()
        || !deskumi_width.is_finite()
        || width <= 0.0
        || height <= 0.0
        || deskumi_width <= 0.0
    {
        return;
    }
    if let Ok(mut guard) = LATEST_ACTIVE_WINDOW.lock() {
        *guard = Some(ActiveWindowSample {
            x,
            y,
            width,
            height,
            deskumi_width,
            updated_at: Instant::now(),
        });
    }
}

/// Clears the cached active desktop window rectangle (e.g. when closed or minimized).
pub fn clear_active_window() {
    if let Ok(mut guard) = LATEST_ACTIVE_WINDOW.lock() {
        *guard = None;
    }
}

/// Scales a compositor-logical active window rect into GTK/GDK coordinates using
/// `gdk_width / deskumi_logical_width`.
pub fn scale_window_rect(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    deskumi_logical_width: f64,
    gdk_width: i32,
) -> Option<(i32, i32, i32, i32)> {
    if !x.is_finite()
        || !y.is_finite()
        || !width.is_finite()
        || !height.is_finite()
        || !deskumi_logical_width.is_finite()
        || width <= 0.0
        || height <= 0.0
        || deskumi_logical_width <= 0.0
        || gdk_width <= 0
    {
        return None;
    }
    let scale = f64::from(gdk_width) / deskumi_logical_width;
    Some((
        (x * scale).round() as i32,
        (y * scale).round() as i32,
        (width * scale).round() as i32,
        (height * scale).round() as i32,
    ))
}

/// Returns the latest active window rectangle scaled to GTK coordinates.
pub fn latest_active_window_rect(gdk_width: i32) -> Option<(i32, i32, i32, i32)> {
    let sample = LATEST_ACTIVE_WINDOW.lock().ok().and_then(|guard| *guard)?;
    if sample.updated_at.elapsed() > WINDOW_SAMPLE_TTL {
        return None;
    }
    scale_window_rect(
        sample.x,
        sample.y,
        sample.width,
        sample.height,
        sample.deskumi_width,
        gdk_width,
    )
}

#[cfg(target_os = "linux")]
mod linux {
    use std::path::PathBuf;
    use std::sync::Mutex;

    use gtk::gio;
    use gtk::gio::prelude::*;
    use gtk::glib;

    const BUS_NAME: &str = "org.deskumi.CursorBridge";
    const OBJECT_PATH: &str = "/org/deskumi/CursorBridge";
    const KWIN_SCRIPT_NAME: &str = "deskumi-cursor-bridge";

    const INTROSPECTION_XML: &str = r#"
<node>
  <interface name="org.deskumi.CursorBridge">
    <method name="ReportNormalizedCursor">
      <arg type="d" name="relX" direction="in"/>
      <arg type="d" name="relY" direction="in"/>
    </method>
    <method name="ReportActiveWindow">
      <arg type="d" name="x" direction="in"/>
      <arg type="d" name="y" direction="in"/>
      <arg type="d" name="width" direction="in"/>
      <arg type="d" name="height" direction="in"/>
      <arg type="d" name="deskumiWidth" direction="in"/>
    </method>
    <method name="ClearActiveWindow"/>
  </interface>
</node>
"#;

    static SCRIPT_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

    pub fn build_kwin_script() -> &'static str {
        r#"var lastSent = 0;
var lastX = -999999;
var lastY = -999999;
var cachedWin = null;
var trackedWin = null;
var lastWinSent = 0;

function findDeskumiWindow() {
  var wins = workspace.windowList();
  for (var i = 0; i < wins.length; i++) {
    var w = wins[i];
    if (w && w.caption === "Deskumi") {
      return w;
    }
  }
  return null;
}

function getDeskumiWin() {
  if (!cachedWin || cachedWin.deleted || cachedWin.caption !== "Deskumi") {
    cachedWin = findDeskumiWindow();
  }
  return cachedWin;
}

function reportCursor() {
  var now = Date.now();
  if (now - lastSent < 30) return;
  var pos = workspace.cursorPos;
  if (!pos) return;
  if (pos.x === lastX && pos.y === lastY) return;

  var dw = getDeskumiWin();
  if (!dw || !dw.frameGeometry) return;

  var g = dw.frameGeometry;
  if (g.width <= 0 || g.height <= 0) return;

  lastSent = now;
  lastX = pos.x;
  lastY = pos.y;

  var relX = (pos.x - g.x) / g.width;
  var relY = (pos.y - g.y) / g.height;
  callDBus(
    "org.deskumi.CursorBridge",
    "/org/deskumi/CursorBridge",
    "org.deskumi.CursorBridge",
    "ReportNormalizedCursor",
    relX,
    relY
  );
}

function isDeskumiWindow(w) {
  return Boolean(w && (w.caption === "Deskumi" || w.caption === "Ajustes de Deskumi"));
}

function isTrackableWindow(w) {
  if (!w || w.deleted || !w.normalWindow || w.minimized || w.fullScreen) {
    return false;
  }
  if (isDeskumiWindow(w)) {
    return false;
  }
  return true;
}

function reportActiveWindow(w) {
  if (!isTrackableWindow(w)) return;
  var now = Date.now();
  if (now - lastWinSent < 16) return;

  var dw = getDeskumiWin();
  if (!dw || !dw.frameGeometry || dw.frameGeometry.width <= 0) return;
  var g = w.frameGeometry;
  if (!g || g.width <= 0 || g.height <= 0) return;

  lastWinSent = now;
  callDBus(
    "org.deskumi.CursorBridge",
    "/org/deskumi/CursorBridge",
    "org.deskumi.CursorBridge",
    "ReportActiveWindow",
    g.x,
    g.y,
    g.width,
    g.height,
    dw.frameGeometry.width
  );
}

function disconnectTrackedWindow(w) {
  if (!w) return;
  try {
    if (w.frameGeometryChanged) w.frameGeometryChanged.disconnect(onTrackedGeometryChanged);
  } catch (e) {}
  try {
    if (w.minimizedChanged) w.minimizedChanged.disconnect(onTrackedStateChanged);
  } catch (e) {}
  try {
    if (w.fullScreenChanged) w.fullScreenChanged.disconnect(onTrackedStateChanged);
  } catch (e) {}
  try {
    if (w.closed) w.closed.disconnect(onTrackedClosed);
  } catch (e) {}
}

function clearActiveWindow() {
  if (trackedWin) {
    disconnectTrackedWindow(trackedWin);
    trackedWin = null;
  }
  callDBus(
    "org.deskumi.CursorBridge",
    "/org/deskumi/CursorBridge",
    "org.deskumi.CursorBridge",
    "ClearActiveWindow"
  );
}

function onTrackedGeometryChanged() {
  if (trackedWin) {
    reportActiveWindow(trackedWin);
  }
}

function onTrackedStateChanged() {
  if (!isTrackableWindow(trackedWin)) {
    clearActiveWindow();
  } else {
    lastWinSent = 0;
    reportActiveWindow(trackedWin);
  }
}

function onTrackedClosed() {
  clearActiveWindow();
}

function onWindowActivated(w) {
  if (isDeskumiWindow(w)) {
    if (trackedWin && !isTrackableWindow(trackedWin)) {
      clearActiveWindow();
    }
    return;
  }
  if (!isTrackableWindow(w)) {
    clearActiveWindow();
    return;
  }
  if (trackedWin && trackedWin !== w) {
    disconnectTrackedWindow(trackedWin);
  }
  trackedWin = w;
  if (trackedWin.frameGeometryChanged) {
    trackedWin.frameGeometryChanged.connect(onTrackedGeometryChanged);
  }
  if (trackedWin.minimizedChanged) {
    trackedWin.minimizedChanged.connect(onTrackedStateChanged);
  }
  if (trackedWin.fullScreenChanged) {
    trackedWin.fullScreenChanged.connect(onTrackedStateChanged);
  }
  if (trackedWin.closed) {
    trackedWin.closed.connect(onTrackedClosed);
  }
  lastWinSent = 0;
  reportActiveWindow(trackedWin);
}

workspace.cursorPosChanged.connect(reportCursor);
workspace.windowActivated.connect(onWindowActivated);
if (workspace.windowRemoved) {
  workspace.windowRemoved.connect(function (w) {
    if (w && trackedWin === w) {
      clearActiveWindow();
    }
  });
}
if (workspace.activeWindow) {
  onWindowActivated(workspace.activeWindow);
}
"#
    }

    fn start_dbus_service() {
        let owner_id = gio::bus_own_name(
            gio::BusType::Session,
            BUS_NAME,
            gio::BusNameOwnerFlags::REPLACE,
            |conn, _name| {
                let node_info = match gio::DBusNodeInfo::for_xml(INTROSPECTION_XML) {
                    Ok(info) => info,
                    Err(e) => {
                        log::warn!("CursorBridge D-Bus XML parse error: {e}");
                        return;
                    }
                };
                let Some(iface_info) = node_info.lookup_interface(BUS_NAME) else {
                    log::warn!("CursorBridge interface missing from XML");
                    return;
                };

                let reg_result = conn.register_object(
                    OBJECT_PATH,
                    &iface_info,
                    |_conn, _sender, _path, _iface, method, params, invocation| {
                        if method == "ReportNormalizedCursor" {
                            if let Some((rel_x, rel_y)) = params.get::<(f64, f64)>() {
                                super::update_normalized_cursor(rel_x, rel_y);
                            }
                            invocation.return_value(None);
                        } else if method == "ReportActiveWindow" {
                            if let Some((x, y, w, h, dw)) = params.get::<(f64, f64, f64, f64, f64)>()
                            {
                                super::update_active_window(x, y, w, h, dw);
                            }
                            invocation.return_value(None);
                        } else if method == "ClearActiveWindow" {
                            super::clear_active_window();
                            invocation.return_value(None);
                        } else {
                            invocation.return_dbus_error(
                                "org.freedesktop.DBus.Error.UnknownMethod",
                                &format!("Unknown method: {method}"),
                            );
                        }
                    },
                    |_conn, _sender, _path, _iface, _prop| glib::Variant::from(0i32),
                    |_conn, _sender, _path, _iface, _prop, _val| false,
                );

                match reg_result {
                    Ok(reg_id) => {
                        // Keep object registered for the lifetime of the process.
                        std::mem::forget(reg_id);
                        log::info!("CursorBridge D-Bus object registered at {OBJECT_PATH}");
                    }
                    Err(e) => {
                        log::warn!("Failed to register CursorBridge D-Bus object: {e}");
                    }
                }
            },
            |_conn, name| {
                log::info!("Acquired D-Bus name: {name}");
            },
            |_conn, name| {
                log::warn!("Lost D-Bus name: {name}");
            },
        );
        // Keep bus name owned for the lifetime of the process.
        std::mem::forget(owner_id);
    }

    fn script_file_path() -> PathBuf {
        let base = std::env::var_os("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        base.join("deskumi-kwin-cursor-bridge.js")
    }

    fn try_load_kwin_script() {
        if std::env::var_os("WAYLAND_DISPLAY").is_none() {
            return;
        }

        let Ok(conn) = gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE) else {
            return;
        };

        // Check if org.kde.KWin /Scripting exists (no-op on GNOME/other DEs).
        let unload_params = (KWIN_SCRIPT_NAME,).to_variant();
        let _ = conn.call_sync(
            Some("org.kde.KWin"),
            "/Scripting",
            "org.kde.kwin.Scripting",
            "unloadScript",
            Some(&unload_params),
            None,
            gio::DBusCallFlags::NONE,
            500,
            gio::Cancellable::NONE,
        );

        let path = script_file_path();
        if let Err(e) = std::fs::write(&path, build_kwin_script()) {
            log::warn!("Failed to write KWin cursor bridge script: {e}");
            return;
        }
        if let Ok(mut guard) = SCRIPT_PATH.lock() {
            *guard = Some(path.clone());
        }

        let path_str = path.to_string_lossy().to_string();
        let load_params = (path_str, KWIN_SCRIPT_NAME).to_variant();
        let load_res = conn.call_sync(
            Some("org.kde.KWin"),
            "/Scripting",
            "org.kde.kwin.Scripting",
            "loadScript",
            Some(&load_params),
            Some(glib::VariantTy::new("(i)").expect("valid variant type")),
            gio::DBusCallFlags::NONE,
            1000,
            gio::Cancellable::NONE,
        );

        match load_res {
            Ok(val) => {
                let script_id = val.get::<(i32,)>().map(|t| t.0).unwrap_or(-1);
                if script_id < 0 {
                    log::debug!("KWin loadScript returned {script_id} (not KDE or rejected)");
                    return;
                }
                let start_res = conn.call_sync(
                    Some("org.kde.KWin"),
                    "/Scripting",
                    "org.kde.kwin.Scripting",
                    "start",
                    None,
                    None,
                    gio::DBusCallFlags::NONE,
                    1000,
                    gio::Cancellable::NONE,
                );
                if let Err(e) = start_res {
                    log::warn!("Failed to start KWin cursor bridge script: {e}");
                } else {
                    log::info!("KWin cursor bridge script loaded and started (id={script_id})");
                }
            }
            Err(e) => {
                log::debug!("KWin Scripting not available (expected outside KDE): {e}");
            }
        }
    }

    pub fn init() {
        start_dbus_service();
        try_load_kwin_script();
    }

    pub fn shutdown() {
        if let Ok(conn) = gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE) {
            let unload_params = (KWIN_SCRIPT_NAME,).to_variant();
            let _ = conn.call_sync(
                Some("org.kde.KWin"),
                "/Scripting",
                "org.kde.kwin.Scripting",
                "unloadScript",
                Some(&unload_params),
                None,
                gio::DBusCallFlags::NONE,
                500,
                gio::Cancellable::NONE,
            );
        }

        if let Ok(mut guard) = SCRIPT_PATH.lock() {
            if let Some(path) = guard.take() {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

/// Initializes the D-Bus cursor bridge and compositor adapter (KWin on KDE Wayland).
pub fn init() {
    #[cfg(target_os = "linux")]
    linux::init();
}

/// Unloads any temporary compositor script and cleans up bridge resources.
pub fn shutdown() {
    #[cfg(target_os = "linux")]
    linux::shutdown();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_to_pixel_maps_center_and_edges() {
        assert_eq!(normalized_to_pixel(0.5, 0.5, 800, 600), Some((400, 300)));
        assert_eq!(normalized_to_pixel(0.0, 1.0, 457, 491), Some((0, 491)));
        assert_eq!(normalized_to_pixel(1.25, -0.5, 400, 600), Some((500, -300)));
    }

    #[test]
    fn normalized_to_pixel_rejects_invalid_inputs() {
        assert_eq!(normalized_to_pixel(f64::NAN, 0.5, 400, 600), None);
        assert_eq!(normalized_to_pixel(0.5, f64::INFINITY, 400, 600), None);
        assert_eq!(normalized_to_pixel(0.5, 0.5, 0, 600), None);
        assert_eq!(normalized_to_pixel(0.5, 0.5, 400, -1), None);
    }

    #[test]
    fn update_and_read_latest_pixel_cursor() {
        update_normalized_cursor(0.75, 0.25);
        assert_eq!(latest_pixel_cursor(800, 600), Some((600, 150)));
    }

    #[test]
    fn scale_window_rect_accounts_for_hidpi_ratio() {
        assert_eq!(
            scale_window_rect(100.0, 200.0, 400.0, 300.0, 400.0, 700),
            Some((175, 350, 700, 525))
        );
        assert_eq!(scale_window_rect(0.0, 0.0, 0.0, 100.0, 400.0, 400), None);
    }

    #[test]
    fn update_and_read_latest_active_window_rect() {
        update_active_window(120.0, 240.0, 500.0, 400.0, 400.0);
        assert_eq!(latest_active_window_rect(800), Some((240, 480, 1000, 800)));
        clear_active_window();
        assert_eq!(latest_active_window_rect(800), None);
    }
}
