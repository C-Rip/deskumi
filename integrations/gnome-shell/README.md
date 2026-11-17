# Deskumi Cursor Bridge — Extensión de GNOME Shell

Extensión opcional para **GNOME Shell 45–50 (Mutter / Wayland)** que conecta el compositor con Deskumi mediante el bus D-Bus `org.deskumi.CursorBridge` ([ADR-0005](../../docs/adr/0005-wayland-global-cursor-bridge.md)).

## Qué habilita

- **Seguimiento global del cursor (`LookAt`):** reporta `global.get_pointer()` normalizado respecto a la ventana `"Deskumi"` (`ReportNormalizedCursor`), funcionando incluso sobre ventanas Wayland nativas y zonas _click-through_.
- **Geometría de la ventana activa (_Window Perch_):** reporta posición, tamaño y cambios de estado de la ventana enfocada (`ReportActiveWindow` / `ClearActiveWindow`) para posar al avatar sobre la barra superior de ventanas.
- **Sin consumo cuando Deskumi está cerrado:** observa `org.deskumi.CursorBridge` con `Gio.bus_watch_name` y solo activa el _polling_ (~30 ms) y señales mientras Deskumi está en ejecución.

## Instalación local (desarrollo)

```bash
mkdir -p ~/.local/share/gnome-shell/extensions
ln -sfn "$(pwd)/integrations/gnome-shell/deskumi-cursor-bridge@deskumi.org" \
  ~/.local/share/gnome-shell/extensions/deskumi-cursor-bridge@deskumi.org
```

En sesiones **Wayland**, cierra sesión y vuelve a iniciar sesión (o usa una sesión anidada de pruebas) para que GNOME Shell descubra la extensión, y luego actívala:

```bash
gnome-extensions enable deskumi-cursor-bridge@deskumi.org
```

## Empaquetado como `.zip`

```bash
gnome-extensions pack \
  integrations/gnome-shell/deskumi-cursor-bridge@deskumi.org \
  --out-dir dist/
gnome-extensions install --force dist/deskumi-cursor-bridge@deskumi.org.shell-extension.zip
```

## Diagnóstico rápido

```bash
gnome-extensions info deskumi-cursor-bridge@deskumi.org
journalctl -f -o cat /usr/bin/gnome-shell
```
