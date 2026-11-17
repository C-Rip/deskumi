import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

const BUS_NAME = "org.deskumi.CursorBridge";
const OBJECT_PATH = "/org/deskumi/CursorBridge";
const INTERFACE_NAME = "org.deskumi.CursorBridge";

const CURSOR_POLL_INTERVAL_MS = 30;
const WINDOW_REPORT_THROTTLE_US = 16_000;
const DBUS_TIMEOUT_MS = 200;

function isDeskumiWindow(win) {
  if (!win) return false;
  const title = win.get_title();
  return title === "Deskumi" || title === "Ajustes de Deskumi";
}

function isWindowFullscreen(win) {
  if (!win) return false;
  if (typeof win.is_fullscreen === "function") {
    return win.is_fullscreen();
  }
  return Boolean(win.fullscreen);
}

function isTrackableWindow(win) {
  if (!win || win.minimized || isWindowFullscreen(win)) {
    return false;
  }
  if (win.get_window_type() !== Meta.WindowType.NORMAL) {
    return false;
  }
  return !isDeskumiWindow(win);
}

function isFocusableWindow(win) {
  if (!win || win.minimized) {
    return false;
  }
  if (win.get_window_type() !== Meta.WindowType.NORMAL) {
    return false;
  }
  return !isDeskumiWindow(win);
}

function normalizeFocusMode(rawMode) {
  const mode = Number(rawMode);
  if (mode === 1 || mode === 2) {
    return mode;
  }
  return 0;
}

function extractAppId(win, windowTracker) {
  if (!win) return "";
  const gtkAppId =
    typeof win.get_gtk_application_id === "function"
      ? win.get_gtk_application_id()
      : null;
  if (gtkAppId && gtkAppId.trim()) {
    return gtkAppId.trim();
  }
  const sandboxAppId =
    typeof win.get_sandboxed_app_id === "function"
      ? win.get_sandboxed_app_id()
      : null;
  if (sandboxAppId && sandboxAppId.trim()) {
    return sandboxAppId.trim();
  }
  const appId = windowTracker?.get_window_app(win)?.get_id();
  if (appId && appId.trim()) {
    return appId.trim().replace(/\.desktop$/i, "");
  }
  const wmClass =
    typeof win.get_wm_class === "function" ? win.get_wm_class() : null;
  return wmClass ? wmClass.trim() : "";
}

function callBridge(method, variant) {
  try {
    Gio.DBus.session.call(
      BUS_NAME,
      OBJECT_PATH,
      INTERFACE_NAME,
      method,
      variant,
      null,
      Gio.DBusCallFlags.NO_AUTO_START,
      DBUS_TIMEOUT_MS,
      null,
      null
    );
  } catch {
    // Ignore transient D-Bus errors when Deskumi is closing.
  }
}

export default class DeskumiCursorBridgeExtension extends Extension {
  enable() {
    this._watchId = 0;
    this._bridgeActive = false;
    this._cursorTimerId = 0;
    this._focusSignalId = 0;
    this._modeChangedSignalId = 0;

    this._lastX = -999999;
    this._lastY = -999999;
    this._lastWinSentUs = 0;

    this._deskumiWin = null;
    this._deskumiUnmanagedId = 0;

    this._trackedWin = null;
    this._trackedSignals = [];

    this._windowTracker = Shell.WindowTracker.get_default();
    this._focusMetadataMode = 0;
    this._focusWin = null;
    this._focusTitleSignalId = 0;
    this._focusUnmanagedSignalId = 0;
    this._lastFocusAppId = "";
    this._lastFocusTitle = "";

    this._watchId = Gio.bus_watch_name(
      Gio.BusType.SESSION,
      BUS_NAME,
      Gio.BusNameWatcherFlags.NONE,
      () => this._onBridgeAppeared(),
      () => this._onBridgeVanished()
    );
  }

  disable() {
    this._onBridgeVanished();
    if (this._watchId) {
      Gio.bus_unwatch_name(this._watchId);
      this._watchId = 0;
    }
    this._windowTracker = null;
  }

  _onBridgeAppeared() {
    if (this._bridgeActive) return;
    this._bridgeActive = true;
    this._lastX = -999999;
    this._lastY = -999999;
    this._lastWinSentUs = 0;
    this._focusMetadataMode = 0;
    this._lastFocusAppId = "";
    this._lastFocusTitle = "";

    this._modeChangedSignalId = Gio.DBus.session.signal_subscribe(
      BUS_NAME,
      INTERFACE_NAME,
      "FocusMetadataModeChanged",
      OBJECT_PATH,
      null,
      Gio.DBusSignalFlags.NONE,
      (_conn, _sender, _path, _iface, _signal, params) => {
        if (!this._bridgeActive || !params) return;
        const [mode] = params.recursiveUnpack();
        this._applyFocusMetadataMode(normalizeFocusMode(mode));
      }
    );

    this._fetchFocusMetadataMode();

    this._focusSignalId = global.display.connect("notify::focus-window", () => {
      this._onFocusWindowChanged();
    });

    this._cursorTimerId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      CURSOR_POLL_INTERVAL_MS,
      () => this._reportCursor()
    );

    this._onFocusWindowChanged();
  }

  _onBridgeVanished() {
    this._bridgeActive = false;
    this._focusMetadataMode = 0;
    this._lastFocusAppId = "";
    this._lastFocusTitle = "";

    if (this._modeChangedSignalId) {
      Gio.DBus.session.signal_unsubscribe(this._modeChangedSignalId);
      this._modeChangedSignalId = 0;
    }

    if (this._cursorTimerId) {
      GLib.source_remove(this._cursorTimerId);
      this._cursorTimerId = 0;
    }

    if (this._focusSignalId) {
      global.display.disconnect(this._focusSignalId);
      this._focusSignalId = 0;
    }

    this._disconnectTrackedWindow();
    this._disconnectFocusWindow();
    this._clearDeskumiCache();
  }

  _fetchFocusMetadataMode() {
    try {
      Gio.DBus.session.call(
        BUS_NAME,
        OBJECT_PATH,
        "org.freedesktop.DBus.Properties",
        "Get",
        new GLib.Variant("(ss)", [INTERFACE_NAME, "FocusMetadataMode"]),
        new GLib.VariantType("(v)"),
        Gio.DBusCallFlags.NO_AUTO_START,
        DBUS_TIMEOUT_MS,
        null,
        (conn, res) => {
          try {
            const reply = conn.call_finish(res);
            if (!this._bridgeActive) return;
            const [mode] = reply.recursiveUnpack();
            this._applyFocusMetadataMode(normalizeFocusMode(mode));
          } catch {
            // Bridge may not expose FocusMetadataMode or vanished during startup.
          }
        }
      );
    } catch {
      // Ignore transient D-Bus errors.
    }
  }

  _applyFocusMetadataMode(mode) {
    if (this._focusMetadataMode === mode) return;
    this._focusMetadataMode = mode;
    this._lastFocusAppId = "";
    this._lastFocusTitle = "";
    this._disconnectFocusWindow();
    if (mode > 0) {
      this._updateFocusMetadataTracking(global.display.focus_window);
    }
  }

  _clearDeskumiCache() {
    if (this._deskumiWin && this._deskumiUnmanagedId) {
      try {
        this._deskumiWin.disconnect(this._deskumiUnmanagedId);
      } catch {
        // Window may already be destroyed.
      }
    }
    this._deskumiWin = null;
    this._deskumiUnmanagedId = 0;
  }

  _getDeskumiWindow() {
    if (this._deskumiWin) {
      if (this._deskumiWin.get_title() === "Deskumi") {
        return this._deskumiWin;
      }
      this._clearDeskumiCache();
    }

    const actors = global.get_window_actors();
    for (const actor of actors) {
      const win = actor?.meta_window;
      if (win && win.get_title() === "Deskumi") {
        this._deskumiWin = win;
        this._deskumiUnmanagedId = win.connect("unmanaged", () => {
          this._clearDeskumiCache();
        });
        return win;
      }
    }
    return null;
  }

  _reportCursor() {
    if (!this._bridgeActive) {
      return GLib.SOURCE_REMOVE;
    }

    const [x, y] = global.get_pointer();
    if (x === this._lastX && y === this._lastY) {
      return GLib.SOURCE_CONTINUE;
    }

    const dw = this._getDeskumiWindow();
    if (!dw) {
      return GLib.SOURCE_CONTINUE;
    }

    const rect = dw.get_frame_rect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return GLib.SOURCE_CONTINUE;
    }

    this._lastX = x;
    this._lastY = y;

    const relX = (x - rect.x) / rect.width;
    const relY = (y - rect.y) / rect.height;

    callBridge(
      "ReportNormalizedCursor",
      new GLib.Variant("(dd)", [relX, relY])
    );
    return GLib.SOURCE_CONTINUE;
  }

  _disconnectTrackedWindow() {
    if (this._trackedWin) {
      for (const id of this._trackedSignals) {
        try {
          this._trackedWin.disconnect(id);
        } catch {
          // Window may already be destroyed.
        }
      }
    }
    this._trackedWin = null;
    this._trackedSignals = [];
  }

  _disconnectFocusWindow() {
    if (this._focusWin) {
      for (const id of [
        this._focusTitleSignalId,
        this._focusUnmanagedSignalId
      ]) {
        if (id) {
          try {
            this._focusWin.disconnect(id);
          } catch {
            // Window may already be destroyed.
          }
        }
      }
    }
    this._focusWin = null;
    this._focusTitleSignalId = 0;
    this._focusUnmanagedSignalId = 0;
  }

  _clearActiveWindow() {
    this._disconnectTrackedWindow();
    if (this._bridgeActive) {
      callBridge("ClearActiveWindow", null);
    }
  }

  _reportActiveWindow(win, force = false) {
    if (!this._bridgeActive || !isTrackableWindow(win)) {
      return;
    }

    const nowUs = GLib.get_monotonic_time();
    if (!force && nowUs - this._lastWinSentUs < WINDOW_REPORT_THROTTLE_US) {
      return;
    }

    const dw = this._getDeskumiWindow();
    if (!dw) return;

    const dRect = dw.get_frame_rect();
    const wRect = win.get_frame_rect();
    if (
      !dRect ||
      dRect.width <= 0 ||
      !wRect ||
      wRect.width <= 0 ||
      wRect.height <= 0
    ) {
      return;
    }

    this._lastWinSentUs = nowUs;
    callBridge(
      "ReportActiveWindow",
      new GLib.Variant("(ddddd)", [
        wRect.x,
        wRect.y,
        wRect.width,
        wRect.height,
        dRect.width
      ])
    );
  }

  _reportWindowFocus(win) {
    if (
      !this._bridgeActive ||
      this._focusMetadataMode <= 0 ||
      !isFocusableWindow(win)
    ) {
      return;
    }

    const appId = extractAppId(win, this._windowTracker);
    const title = this._focusMetadataMode === 2 ? (win.get_title() ?? "") : "";
    if (!appId && !title) {
      return;
    }
    if (appId === this._lastFocusAppId && title === this._lastFocusTitle) {
      return;
    }

    this._lastFocusAppId = appId;
    this._lastFocusTitle = title;
    callBridge("ReportWindowFocus", new GLib.Variant("(ss)", [appId, title]));
  }

  _onTrackedGeometryChanged() {
    if (this._trackedWin) {
      this._reportActiveWindow(this._trackedWin, false);
    }
  }

  _onTrackedStateChanged() {
    if (!isTrackableWindow(this._trackedWin)) {
      this._clearActiveWindow();
    } else {
      this._reportActiveWindow(this._trackedWin, true);
    }
  }

  _updateFocusMetadataTracking(win) {
    if (!this._bridgeActive || this._focusMetadataMode <= 0) {
      return;
    }
    if (isDeskumiWindow(win)) {
      return;
    }
    if (!isFocusableWindow(win)) {
      this._disconnectFocusWindow();
      this._lastFocusAppId = "";
      this._lastFocusTitle = "";
      return;
    }

    if (this._focusWin !== win) {
      this._disconnectFocusWindow();
      this._focusWin = win;
      if (this._focusMetadataMode === 2) {
        this._focusTitleSignalId = win.connect("notify::title", () => {
          if (this._focusWin === win && this._focusMetadataMode === 2) {
            this._reportWindowFocus(win);
          }
        });
      }
      this._focusUnmanagedSignalId = win.connect("unmanaged", () => {
        if (this._focusWin === win) {
          this._disconnectFocusWindow();
          this._lastFocusAppId = "";
          this._lastFocusTitle = "";
        }
      });
    }

    this._reportWindowFocus(win);
  }

  _onFocusWindowChanged() {
    const win = global.display.focus_window;
    this._updateFocusMetadataTracking(win);

    if (isDeskumiWindow(win)) {
      if (this._trackedWin && !isTrackableWindow(this._trackedWin)) {
        this._clearActiveWindow();
      }
      return;
    }

    if (!isTrackableWindow(win)) {
      this._clearActiveWindow();
      return;
    }

    if (this._trackedWin && this._trackedWin !== win) {
      this._disconnectTrackedWindow();
    }

    if (this._trackedWin !== win) {
      this._trackedWin = win;
      this._trackedSignals = [
        win.connect("position-changed", () => this._onTrackedGeometryChanged()),
        win.connect("size-changed", () => this._onTrackedGeometryChanged()),
        win.connect("notify::minimized", () => this._onTrackedStateChanged()),
        win.connect("notify::fullscreen", () => this._onTrackedStateChanged()),
        win.connect("unmanaged", () => this._clearActiveWindow())
      ];
    }

    this._reportActiveWindow(win, true);
  }
}
