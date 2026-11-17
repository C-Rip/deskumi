//! Multi-compositor Wayland global cursor & window focus bridge (`org.deskumi.CursorBridge`).
//!
//! On Wayland compositors (KDE KWin, GNOME Mutter), XWayland and Wayland clients
//! stop receiving global pointer coordinates when the cursor enters native
//! Wayland surfaces or click-through transparent regions, and cannot inspect
//! active window `appId` / `title` of other desktop clients.
//!
//! This module exposes a session D-Bus endpoint (`org.deskumi.CursorBridge`)
//! with:
//! - `ReportNormalizedCursor(relX: f64, relY: f64)` relative to the `"Deskumi"` window geometry,
//! - `ReportActiveWindow(x, y, width, height, deskumiWidth)` / `ClearActiveWindow()` for window perch,
//! - `ReportWindowFocus(appId: String, title: String)` governed by `FocusMetadataMode` (`u32`: `0 = off`,
//!   `1 = appId`, `2 = appId + title`) and `FocusMetadataModeChanged(u)` signal so compositors do not
//!   send sensitive metadata over D-Bus when disabled.

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

const CURSOR_SAMPLE_TTL: Duration = Duration::from_secs(10);

/// Maximum character count allowed for `appId` and `title` focus metadata fields.
pub const MAX_FOCUS_METADATA_CHARS: usize = 256;

/// Tauri event emitted when the sanitized active window focus metadata changes.
pub const WINDOW_FOCUS_EVENT_NAME: &str = "cursor-bridge-window-focus";

/// Privacy mode controlling which window focus metadata compositors may send over D-Bus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FocusMetadataMode {
    Off = 0,
    AppIdOnly = 1,
    AppIdAndTitle = 2,
}

impl FocusMetadataMode {
    pub fn from_u8(value: u8) -> Result<Self, AppError> {
        match value {
            0 => Ok(Self::Off),
            1 => Ok(Self::AppIdOnly),
            2 => Ok(Self::AppIdAndTitle),
            _ => Err(AppError::Platform(format!(
                "Invalid focus metadata mode: {value} (expected 0, 1, or 2)"
            ))),
        }
    }

    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

/// Sanitized active window focus metadata reported by the compositor bridge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowFocusMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

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
}

static LATEST_CURSOR: Mutex<Option<CursorSample>> = Mutex::new(None);
static LATEST_ACTIVE_WINDOW: Mutex<Option<ActiveWindowSample>> = Mutex::new(None);
static FOCUS_METADATA_MODE: AtomicU8 = AtomicU8::new(0);
static LATEST_WINDOW_FOCUS: Mutex<Option<WindowFocusMetadata>> = Mutex::new(None);
static APP_HANDLE: Mutex<Option<tauri::AppHandle>> = Mutex::new(None);

/// Stores the Tauri `AppHandle` used to emit sanitized window focus events to the WebView.
pub fn attach_app_handle(app: tauri::AppHandle) {
    if let Ok(mut guard) = APP_HANDLE.lock() {
        *guard = Some(app);
    }
}

/// Returns the active [`FocusMetadataMode`] governing D-Bus `ReportWindowFocus` reporting.
pub fn current_focus_metadata_mode() -> FocusMetadataMode {
    match FOCUS_METADATA_MODE.load(Ordering::SeqCst) {
        1 => FocusMetadataMode::AppIdOnly,
        2 => FocusMetadataMode::AppIdAndTitle,
        _ => FocusMetadataMode::Off,
    }
}

/// Strips control characters, trims whitespace, and truncates to [`MAX_FOCUS_METADATA_CHARS`].
pub fn sanitize_focus_field(raw: &str) -> Option<String> {
    let cleaned: String = raw.chars().filter(|c| !c.is_control()).collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        return None;
    }
    let truncated: String = trimmed.chars().take(MAX_FOCUS_METADATA_CHARS).collect();
    let final_str = truncated.trim_end();
    if final_str.is_empty() {
        None
    } else {
        Some(final_str.to_string())
    }
}

/// Applies [`FocusMetadataMode`] filtering and field sanitization to raw compositor strings.
pub fn filter_window_focus(
    mode: FocusMetadataMode,
    raw_app_id: &str,
    raw_title: &str,
) -> Option<WindowFocusMetadata> {
    match mode {
        FocusMetadataMode::Off => None,
        FocusMetadataMode::AppIdOnly => {
            let app_id = sanitize_focus_field(raw_app_id)?;
            Some(WindowFocusMetadata {
                app_id: Some(app_id),
                title: None,
            })
        }
        FocusMetadataMode::AppIdAndTitle => {
            let app_id = sanitize_focus_field(raw_app_id);
            let title = sanitize_focus_field(raw_title);
            if app_id.is_none() && title.is_none() {
                None
            } else {
                Some(WindowFocusMetadata { app_id, title })
            }
        }
    }
}

/// Updates the in-memory [`FocusMetadataMode`] and redacts/clears cached metadata accordingly.
/// Returns `true` when the mode value changed.
pub fn set_focus_metadata_mode_state(mode: FocusMetadataMode) -> bool {
    let prev = FOCUS_METADATA_MODE.swap(mode.as_u8(), Ordering::SeqCst);
    if let Ok(mut guard) = LATEST_WINDOW_FOCUS.lock() {
        match mode {
            FocusMetadataMode::Off => *guard = None,
            FocusMetadataMode::AppIdOnly => {
                if let Some(ref mut meta) = *guard {
                    meta.title = None;
                    if meta.app_id.is_none() {
                        *guard = None;
                    }
                }
            }
            FocusMetadataMode::AppIdAndTitle => {}
        }
    }
    prev != mode.as_u8()
}

fn emit_window_focus_event(metadata: &WindowFocusMetadata) {
    let app = APP_HANDLE
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().cloned());
    if let Some(app) = app {
        use tauri::Emitter;
        if let Err(err) = app.emit(WINDOW_FOCUS_EVENT_NAME, metadata) {
            log::warn!("Failed to emit {WINDOW_FOCUS_EVENT_NAME}: {err}");
        }
    }
}

/// Stores sanitized window focus metadata under the active [`FocusMetadataMode`].
/// Returns `true` if a non-empty focus entry changed and was stored/emitted.
pub fn update_window_focus(raw_app_id: &str, raw_title: &str) -> bool {
    let mode = current_focus_metadata_mode();
    if mode == FocusMetadataMode::Off {
        return false;
    }

    let next = filter_window_focus(mode, raw_app_id, raw_title);
    let changed = {
        let Ok(mut guard) = LATEST_WINDOW_FOCUS.lock() else {
            return false;
        };
        if *guard == next {
            return false;
        }
        *guard = next.clone();
        next.is_some()
    };

    if let Some(ref metadata) = next {
        emit_window_focus_event(metadata);
    }
    changed
}

/// Returns the latest sanitized window focus metadata permitted by [`current_focus_metadata_mode`].
pub fn latest_window_focus_metadata() -> Option<WindowFocusMetadata> {
    let mode = current_focus_metadata_mode();
    if mode == FocusMetadataMode::Off {
        return None;
    }
    let mut meta = LATEST_WINDOW_FOCUS
        .lock()
        .ok()
        .and_then(|guard| guard.clone())?;
    if mode == FocusMetadataMode::AppIdOnly {
        meta.title = None;
        meta.app_id.as_ref()?;
    }
    Some(meta)
}

/// Tauri command updating the active `FocusMetadataMode` (`0 = off`, `1 = appId`, `2 = appId + title`)
/// and notifying Linux compositor bridges over D-Bus (`FocusMetadataModeChanged(u)`).
#[tauri::command]
pub fn set_focus_metadata_mode(mode: u8) -> Result<(), AppError> {
    let parsed = FocusMetadataMode::from_u8(mode)?;
    let changed = set_focus_metadata_mode_state(parsed);
    if changed {
        #[cfg(target_os = "linux")]
        linux::on_focus_metadata_mode_changed(parsed);
    }
    Ok(())
}

/// Tauri command returning the latest sanitized `{ appId?, title? }` focus metadata.
#[tauri::command]
pub fn get_window_focus_metadata() -> Result<Option<WindowFocusMetadata>, AppError> {
    Ok(latest_window_focus_metadata())
}

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
/// Remains valid until replaced or cleared via [`clear_active_window`].
pub fn latest_active_window_rect(gdk_width: i32) -> Option<(i32, i32, i32, i32)> {
    let sample = LATEST_ACTIVE_WINDOW.lock().ok().and_then(|guard| *guard)?;
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
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    use gtk::gio;
    use gtk::gio::prelude::*;
    use gtk::glib;

    use super::FocusMetadataMode;

    pub(super) const BUS_NAME: &str = "org.deskumi.CursorBridge";
    const OBJECT_PATH: &str = "/org/deskumi/CursorBridge";
    const KWIN_SCRIPT_NAME: &str = "deskumi-cursor-bridge";

    pub(super) const INTROSPECTION_XML: &str = r#"
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
    <method name="ReportWindowFocus">
      <arg type="s" name="appId" direction="in"/>
      <arg type="s" name="title" direction="in"/>
    </method>
    <property name="FocusMetadataMode" type="u" access="read"/>
    <signal name="FocusMetadataModeChanged">
      <arg type="u" name="mode"/>
    </signal>
  </interface>
</node>
"#;

    static SCRIPT_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);
    static KWIN_LOAD_LOCK: Mutex<()> = Mutex::new(());
    static BRIDGE_ACTIVE: AtomicBool = AtomicBool::new(false);
    static KWIN_SCRIPT_LOADED: AtomicBool = AtomicBool::new(false);

    pub fn build_kwin_script() -> &'static str {
        r#"var lastSent = 0;
var lastX = -999999;
var lastY = -999999;
var cachedWin = null;
var trackedWin = null;
var lastWinSent = 0;
var focusMetadataMode = 0;
var focusTrackedWin = null;
var lastFocusAppId = "";
var lastFocusTitle = "";

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

function isFocusableWindow(w) {
  if (!w || w.deleted || !w.normalWindow || w.minimized) {
    return false;
  }
  return !isDeskumiWindow(w);
}

function extractAppId(w) {
  if (!w) return "";
  var desktop = w.desktopFileName ? String(w.desktopFileName).trim() : "";
  if (desktop.length > 0) {
    var slashIdx = desktop.lastIndexOf("/");
    if (slashIdx >= 0) desktop = desktop.slice(slashIdx + 1);
    if (desktop.length > 8 && desktop.slice(-8).toLowerCase() === ".desktop") {
      desktop = desktop.slice(0, -8);
    }
    if (desktop.length > 0) return desktop;
  }
  return w.resourceClass ? String(w.resourceClass).trim() : "";
}

function refreshFocusMetadataMode(onDone) {
  callDBus(
    "org.deskumi.CursorBridge",
    "/org/deskumi/CursorBridge",
    "org.freedesktop.DBus.Properties",
    "Get",
    "org.deskumi.CursorBridge",
    "FocusMetadataMode",
    function (mode) {
      var parsed = Number(mode);
      if (parsed === 1 || parsed === 2) {
        focusMetadataMode = parsed;
      } else {
        focusMetadataMode = 0;
      }
      if (focusMetadataMode === 0) {
        lastFocusAppId = "";
        lastFocusTitle = "";
        disconnectFocusWindow();
      } else if (focusMetadataMode < 2) {
        lastFocusTitle = "";
      }
      if (onDone) onDone();
    }
  );
}

function sendWindowFocusNow(w) {
  if (focusMetadataMode <= 0 || !isFocusableWindow(w) || w !== focusTrackedWin) {
    return;
  }
  var appId = extractAppId(w);
  var title = focusMetadataMode >= 2 && w.caption ? String(w.caption) : "";
  if (appId.length === 0 && title.length === 0) {
    return;
  }
  if (appId === lastFocusAppId && title === lastFocusTitle) {
    return;
  }
  lastFocusAppId = appId;
  lastFocusTitle = title;
  callDBus(
    "org.deskumi.CursorBridge",
    "/org/deskumi/CursorBridge",
    "org.deskumi.CursorBridge",
    "ReportWindowFocus",
    appId,
    title
  );
}

function reportWindowFocus(w) {
  if (focusMetadataMode <= 0 || !isFocusableWindow(w)) {
    return;
  }
  refreshFocusMetadataMode(function () {
    sendWindowFocusNow(w);
  });
}

function disconnectFocusWindow() {
  if (!focusTrackedWin) return;
  try {
    if (focusTrackedWin.captionChanged) {
      focusTrackedWin.captionChanged.disconnect(onFocusCaptionChanged);
    }
  } catch (e) {}
  try {
    if (focusTrackedWin.closed) {
      focusTrackedWin.closed.disconnect(onFocusClosed);
    }
  } catch (e) {}
  focusTrackedWin = null;
}

function onFocusCaptionChanged() {
  if (focusMetadataMode < 2 || !focusTrackedWin) return;
  reportWindowFocus(focusTrackedWin);
}

function onFocusClosed() {
  disconnectFocusWindow();
  lastFocusAppId = "";
  lastFocusTitle = "";
}

function handleFocusMetadataOnActivate(w) {
  if (focusMetadataMode <= 0 || isDeskumiWindow(w)) {
    return;
  }
  if (!isFocusableWindow(w)) {
    disconnectFocusWindow();
    lastFocusAppId = "";
    lastFocusTitle = "";
    return;
  }
  if (focusTrackedWin && focusTrackedWin !== w) {
    disconnectFocusWindow();
  }
  if (focusTrackedWin !== w) {
    focusTrackedWin = w;
    if (focusMetadataMode >= 2 && focusTrackedWin.captionChanged) {
      focusTrackedWin.captionChanged.connect(onFocusCaptionChanged);
    }
    if (focusTrackedWin.closed) {
      focusTrackedWin.closed.connect(onFocusClosed);
    }
  }
  reportWindowFocus(focusTrackedWin);
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
  handleFocusMetadataOnActivate(w);

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
    if (w && focusTrackedWin === w) {
      onFocusClosed();
    }
  });
}
if (workspace.activeWindow) {
  onWindowActivated(workspace.activeWindow);
}
refreshFocusMetadataMode(function () {
  if (focusMetadataMode > 0 && workspace.activeWindow) {
    handleFocusMetadataOnActivate(workspace.activeWindow);
  }
});
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
                            if let Some((x, y, w, h, dw)) =
                                params.get::<(f64, f64, f64, f64, f64)>()
                            {
                                super::update_active_window(x, y, w, h, dw);
                            }
                            invocation.return_value(None);
                        } else if method == "ClearActiveWindow" {
                            super::clear_active_window();
                            invocation.return_value(None);
                        } else if method == "ReportWindowFocus" {
                            if let Some((app_id, title)) = params.get::<(String, String)>() {
                                super::update_window_focus(&app_id, &title);
                            }
                            invocation.return_value(None);
                        } else {
                            invocation.return_dbus_error(
                                "org.freedesktop.DBus.Error.UnknownMethod",
                                &format!("Unknown method: {method}"),
                            );
                        }
                    },
                    |_conn, _sender, _path, _iface, prop| {
                        if prop == "FocusMetadataMode" {
                            glib::Variant::from(u32::from(
                                super::current_focus_metadata_mode().as_u8(),
                            ))
                        } else {
                            glib::Variant::from(0u32)
                        }
                    },
                    |_conn, _sender, _path, _iface, _prop, _val| false,
                );

                match reg_result {
                    Ok(reg_id) => {
                        // Keep object registered for the lifetime of the process.
                        let _ = reg_id;
                        BRIDGE_ACTIVE.store(true, Ordering::SeqCst);
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
                BRIDGE_ACTIVE.store(false, Ordering::SeqCst);
                log::warn!("Lost D-Bus name: {name}");
            },
        );
        // Keep bus name owned for the lifetime of the process.
        let _ = owner_id;
    }

    pub fn on_focus_metadata_mode_changed(mode: FocusMetadataMode) {
        if BRIDGE_ACTIVE.load(Ordering::SeqCst) {
            if let Ok(conn) = gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE) {
                let params = (u32::from(mode.as_u8()),).to_variant();
                if let Err(err) = conn.emit_signal(
                    None,
                    OBJECT_PATH,
                    BUS_NAME,
                    "FocusMetadataModeChanged",
                    Some(&params),
                ) {
                    log::warn!("Failed to emit FocusMetadataModeChanged signal: {err}");
                }
            }
        }

        if KWIN_SCRIPT_LOADED.load(Ordering::SeqCst) {
            std::thread::spawn(|| {
                try_load_kwin_script();
            });
        }
    }

    fn script_file_path() -> PathBuf {
        let base = std::env::var_os("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        base.join("deskumi-kwin-cursor-bridge.js")
    }

    fn try_load_kwin_script() {
        let Ok(_guard) = KWIN_LOAD_LOCK.lock() else {
            return;
        };

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
                    KWIN_SCRIPT_LOADED.store(true, Ordering::SeqCst);
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
        BRIDGE_ACTIVE.store(false, Ordering::SeqCst);
        let was_kwin_loaded = KWIN_SCRIPT_LOADED.swap(false, Ordering::SeqCst);
        if was_kwin_loaded {
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
    if let Ok(mut guard) = APP_HANDLE.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = LATEST_WINDOW_FOCUS.lock() {
        *guard = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static TEST_FOCUS_STATE_LOCK: Mutex<()> = Mutex::new(());

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

    #[test]
    fn focus_metadata_mode_validates_bounds() {
        assert_eq!(
            FocusMetadataMode::from_u8(0).ok(),
            Some(FocusMetadataMode::Off)
        );
        assert_eq!(
            FocusMetadataMode::from_u8(1).ok(),
            Some(FocusMetadataMode::AppIdOnly)
        );
        assert_eq!(
            FocusMetadataMode::from_u8(2).ok(),
            Some(FocusMetadataMode::AppIdAndTitle)
        );
        assert!(FocusMetadataMode::from_u8(3).is_err());
        assert!(FocusMetadataMode::from_u8(255).is_err());
    }

    #[test]
    fn sanitize_focus_field_strips_control_chars_and_truncates_256_utf8_chars() {
        assert_eq!(
            sanitize_focus_field(" \x00org.mozilla.\x1bfirefox\n\r\t "),
            Some("org.mozilla.firefox".to_string())
        );
        assert_eq!(sanitize_focus_field("\x00\n\t\x7f   "), None);

        let long_ascii = "a".repeat(300);
        assert_eq!(
            sanitize_focus_field(&long_ascii).map(|s| s.chars().count()),
            Some(MAX_FOCUS_METADATA_CHARS)
        );

        let long_utf8 = "あ".repeat(280);
        let sanitized_utf8 = sanitize_focus_field(&long_utf8).expect("utf8 truncated");
        assert_eq!(sanitized_utf8.chars().count(), MAX_FOCUS_METADATA_CHARS);
        assert!(sanitized_utf8.chars().all(|c| c == 'あ'));

        let long_emoji = "🚀".repeat(270);
        let sanitized_emoji = sanitize_focus_field(&long_emoji).expect("emoji truncated");
        assert_eq!(sanitized_emoji.chars().count(), MAX_FOCUS_METADATA_CHARS);
    }

    #[test]
    fn filter_window_focus_enforces_mode_0_1_2() {
        assert_eq!(
            filter_window_focus(FocusMetadataMode::Off, "org.mozilla.firefox", "Secret"),
            None
        );
        assert_eq!(
            filter_window_focus(
                FocusMetadataMode::AppIdOnly,
                "org.mozilla.firefox",
                "Secret Tab"
            ),
            Some(WindowFocusMetadata {
                app_id: Some("org.mozilla.firefox".to_string()),
                title: None,
            })
        );
        assert_eq!(
            filter_window_focus(FocusMetadataMode::AppIdOnly, "\x00\n", "Secret Tab"),
            None
        );
        assert_eq!(
            filter_window_focus(
                FocusMetadataMode::AppIdAndTitle,
                "org.mozilla.firefox",
                "Secret\x1b Tab\n"
            ),
            Some(WindowFocusMetadata {
                app_id: Some("org.mozilla.firefox".to_string()),
                title: Some("Secret Tab".to_string()),
            })
        );
        assert_eq!(
            filter_window_focus(FocusMetadataMode::AppIdAndTitle, "", "Calculator"),
            Some(WindowFocusMetadata {
                app_id: None,
                title: Some("Calculator".to_string()),
            })
        );
    }

    #[test]
    fn window_focus_state_respects_mode_transitions_and_deduplication() {
        let _lock = TEST_FOCUS_STATE_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        set_focus_metadata_mode_state(FocusMetadataMode::Off);
        assert!(!update_window_focus("org.mozilla.firefox", "Secret"));
        assert_eq!(latest_window_focus_metadata(), None);

        // Mode 1: stores appId, strips title, deduplicates identical updates
        assert!(set_focus_metadata_mode_state(FocusMetadataMode::AppIdOnly));
        assert!(update_window_focus("org.mozilla.firefox", "Private Page"));
        assert_eq!(
            latest_window_focus_metadata(),
            Some(WindowFocusMetadata {
                app_id: Some("org.mozilla.firefox".to_string()),
                title: None,
            })
        );
        // Same appId with different title in mode 1 is suppressed & ignored
        assert!(!update_window_focus("org.mozilla.firefox", "Another Page"));

        // Mode 2: includes sanitized/truncated title
        assert!(set_focus_metadata_mode_state(
            FocusMetadataMode::AppIdAndTitle
        ));
        let long_title = format!("Docs — {}\n\x00", "x".repeat(300));
        assert!(update_window_focus("org.mozilla.firefox", &long_title));
        let stored = latest_window_focus_metadata().expect("mode 2 metadata");
        assert_eq!(stored.app_id.as_deref(), Some("org.mozilla.firefox"));
        assert_eq!(
            stored.title.as_ref().map(|t| t.chars().count()),
            Some(MAX_FOCUS_METADATA_CHARS)
        );

        // Downgrading 2 -> 1 immediately strips cached title
        assert!(set_focus_metadata_mode_state(FocusMetadataMode::AppIdOnly));
        assert_eq!(
            latest_window_focus_metadata(),
            Some(WindowFocusMetadata {
                app_id: Some("org.mozilla.firefox".to_string()),
                title: None,
            })
        );

        // Downgrading 1 -> 0 immediately clears cached metadata
        assert!(set_focus_metadata_mode_state(FocusMetadataMode::Off));
        assert_eq!(latest_window_focus_metadata(), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn kwin_script_checks_focus_metadata_mode_before_sending_title() {
        let script = linux::build_kwin_script();
        assert!(script.contains("FocusMetadataMode"));
        assert!(script.contains("ReportWindowFocus"));
        assert!(script.contains("desktopFileName"));
        assert!(script.contains("resourceClass"));
        assert!(script.contains("focusMetadataMode >= 2"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn dbus_introspection_xml_declares_window_focus_contract() {
        let node = gtk::gio::DBusNodeInfo::for_xml(linux::INTROSPECTION_XML)
            .expect("valid D-Bus introspection XML");
        let iface = node
            .lookup_interface(linux::BUS_NAME)
            .expect("org.deskumi.CursorBridge interface present");
        assert!(iface.lookup_method("ReportNormalizedCursor").is_some());
        assert!(iface.lookup_method("ReportActiveWindow").is_some());
        assert!(iface.lookup_method("ClearActiveWindow").is_some());
        assert!(iface.lookup_method("ReportWindowFocus").is_some());
        assert!(iface.lookup_property("FocusMetadataMode").is_some());
        assert!(iface.lookup_signal("FocusMetadataModeChanged").is_some());
    }
}
