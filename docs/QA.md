# QA — Matriz de pruebas manuales

Los efectos de ventana (transparencia, click-through, always-on-top) **no se pueden
testear en CI**. Cada PR que los toque debe correr los casos relevantes en al menos un
entorno y anotarlo en el PR. Antes de un release se corre todo en todos los entornos.

## Entornos objetivo
| ID | Máquina | Distro | DE | Sesión | GPU |
| --- | --- | --- | --- | --- | --- |
| E1 | Desktop trabajo | Fedora 44 | GNOME | Wayland (+XWayland) | Intel HD 630 |
| E2 | PC personal | Nobara | KDE Plasma | Wayland (+XWayland) | _(completar)_ |
| E3 | Laptop | Debian | GNOME | Wayland (+XWayland) | _(completar)_ |
| E4 | — | Windows 11 | — | Win32 | _(completar)_ |

## Casos
| ID | Caso | Esperado | E1 | E2 | E3 | E4 |
| --- | --- | --- | --- | --- | --- | --- |
| Q-01 | Arranque | Ventana sin bordes, sin sombra, fondo 100 % transparente (sin negro ni blanco) | | | | |
| Q-02 | Always-on-top | Queda encima al enfocar otra app | | | | |
| Q-03 | Click-through vacío | Clic en zona vacía activa la app de abajo | | | | |
| Q-04 | Click en personaje | Clic sobre el personaje lo recibe la app | | | | |
| Q-05 | Arrastrar | Se puede mover agarrando al personaje | | | | |
| Q-06 | LookAt | La cabeza/ojos siguen el cursor | | | | |
| Q-07 | Bordes | Sin halos/artefactos en el contorno (premultiplied alpha) | | | | |
| Q-08 | Multi-monitor | Se puede arrastrar a otro monitor | | | | |
| Q-09 | HiDPI | Nítido con escala 125 %/150 % | | | | |
| Q-10 | Reposo | CPU < 3 % tras 60 s sin interacción | | | | |
| Q-11 | Tray | Menú funciona; "Salir" cierra todo | | | | |
| Q-12 | Suspender/reanudar | Sigue renderizando tras suspender | | | | |

Marca: ✅ ok · ⚠️ con detalle (explicar) · ❌ falla (abrir issue) · — no aplica.
Variantes Linux: probar `GDK_BACKEND=x11` (por defecto) y `DESKTOP_ENGINE_WAYLAND=1`.
