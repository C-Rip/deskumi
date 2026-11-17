# Hello Companion (Example Plugin)

Minimal reference plugin for Deskumi that subscribes to avatar `click` events
and reacts differently depending on whether you click the avatar's `"head"`
(`surprised` expression + speech bubble) or `"body"` (`happy` expression +
speech bubble).

## License

This example plugin is licensed under the **MIT License** — see
[`../../LICENSE`](../../LICENSE). You may freely copy, modify, and reuse it as a
starting point for your own plugins.

## Files

- [`manifest.json`](manifest.json) — Plugin metadata (`id: "hello-companion"`)
  and requested permissions (`avatar:expression`, `avatar:speak`, `avatar:events`).
- [`index.html`](index.html) — Minimal entry HTML loading `./main.js` with no
  inline scripts or styles so it complies with Deskumi's strict `plugin://` CSP.
- [`main.js`](main.js) — Listens for `deskumi:plugin` `postMessage` envelopes
  from `window.parent`, sends `hello` to subscribe to `["click"]`, and issues
  `expression` + `say` commands on clicks.

## Installation & Testing

1. Copy this directory into Deskumi's plugins folder (`$APPDATA/plugins/hello-companion/`):

   - **Linux** (`$XDG_DATA_HOME`, default `~/.local/share`):

     ```bash
     mkdir -p "${XDG_DATA_HOME:-$HOME/.local/share}/dev.crivera.deskumi/plugins"
     cp -r examples/plugins/hello-companion \
       "${XDG_DATA_HOME:-$HOME/.local/share}/dev.crivera.deskumi/plugins/hello-companion"
     ```

   - **Windows** (when supported, see [`docs/LIMITATIONS.md`](../../../docs/LIMITATIONS.md)):
     copy to `%APPDATA%\dev.crivera.deskumi\plugins\hello-companion\`.

2. Open Deskumi **Ajustes** (Settings) from the system tray and scroll to
   **Plugins aislados y animaciones**.
3. Click **↻ Recargar plugins** if `Hello Companion` (`hello-companion`) does not
   appear immediately.
4. Explicitly check and grant the three requested permissions:
   - `avatar:expression`
   - `avatar:speak`
   - `avatar:events`
5. Click **Activar** on `Hello Companion`.
6. Click the avatar's head or body on your desktop:
   - **Head click:** avatar shows `surprised` expression and says `"Whoa! Careful with my head!"`.
   - **Body click:** avatar shows `happy` expression and says `"Hello! Nice to meet you!"`.

## Security Notes

- Runs inside `<iframe sandbox="allow-scripts">` (no `allow-same-origin`) served
  over `plugin://hello-companion/index.html` with
  `Content-Security-Policy: default-src 'none'; script-src plugin://hello-companion; worker-src 'none'; connect-src 'none'`.
- Has zero access to `@tauri-apps/*`, `window.__TAURI__`, `fetch`, `WebSocket`,
  `Worker`, or the host DOM.
- See [`docs/PLUGINS.md`](../../../docs/PLUGINS.md) for the full authoring guide.
