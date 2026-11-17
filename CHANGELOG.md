# Changelog

Todos los cambios notables se documentan aquí.
Formato: [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) ·
Versionado: [SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Added

- **Motor de habla, _lip-sync_ y burbuja de diálogo (`T-602`..`T-604`)**: Contrato versionado `AvatarCommand`/`AvatarEvent` (`v: 1`), `AvatarController` de 4 canales arbitrados con _wake locks_ en `PowerSaveController`, reproducción de audio en frío con `AudioOutput` + `LipSyncController` (visemas y respaldo RMS) + `SpeechController`, y `SpeechBubbleOverlay` (`pointer-events: none`, anclado al hueso `head`).
- **Puente WebSocket local `127.0.0.1` (`T-605`, `T-609`)**: Servidor loopback en `local_bridge.rs` (`bridge.json` atómico `0600`, anti-CSWSH sin cabecera `Origin`, token de 256 bits, tramas binarias `DSK1` vía `tauri::ipc::Channel`), cliente Python MIT de referencia (`examples/bridge/echo_tts_bridge.py`) y eventos `windowFocus` con privacidad graduada (`desktop:events` / `desktop:windowTitle`) sobre `org.deskumi.CursorBridge`.
- **Host de plugins aislados `plugin://` (`T-606`)**: Esquema personalizado en `plugins.rs` con CSP estricta (`default-src 'none'`), montaje en `<iframe sandbox="allow-scripts">` (`PluginHost`) y registro lógico de animaciones `.vrma`.
- **Ajustes de Puente WebSocket y Plugins (T-607)**: Secciones de configuración en Ajustes para el puente loopback local (`127.0.0.1`, estado en vivo, regeneración/copia de token y scopes con `desktop:windowTitle` desactivado por defecto) y gestor de plugins aislados (consentimiento explícito de permisos, límite de 3 activos y registro de animaciones `.vrma` por ID lógico), junto con capacidades `localBridge`/`plugins` en `PlatformCaps` y sincronización en vivo con el runtime.
- **Documentación, esquemas JSON, plugin de ejemplo MIT y QA F6 (`T-608`)**: Guía completa en `docs/PLUGINS.md` (con recetas para VOICEVOX, Piper, Kokoro-82M/`sherpa-onnx`, GPT-SoVITS y RVC), esquemas en `docs/schemas/`, plugin de ejemplo MIT `examples/plugins/hello-companion/`, casos de seguridad/soak en `docs/QA.md` y skill `.agents/skills/plugin-authoring/SKILL.md`.

## [0.2.1] - 2026-11-17

### Added

- **Extensión de GNOME Shell (`deskumi-cursor-bridge@deskumi.org`)**: Puente D-Bus para GNOME Shell 45–50 (Mutter / Wayland) en `integrations/gnome-shell/` que reporta cursor global y geometría de ventana activa a `org.deskumi.CursorBridge`, empaquetado automáticamente en `/usr/share/gnome-shell/extensions/` para paquetes `.deb` y `.rpm`.
- **Alineación de sentado por hueso `hips`**: Proyección en pantalla del hueso `hips` (`getBoneScreenBottomFraction`) para posar al avatar sobre la barra de título con precisión independiente de la escala o anatomía del modelo VRM.

### Fixed

- **Estabilidad de _Window Perch_**: Se eliminó la expiración automática de 30 s (`WINDOW_SAMPLE_TTL`) de la ventana activa, se desmonta al detectar arrastre manual (`notifyManualDrag`), al empujar la ventana actual al borde superior o cuando una ventana maximizada cubre el punto de apoyo.
- **Recorte al sentarse**: Se suavizó el encogimiento vertical del marco de `0.72` a `0.84` (mínimo `220 px`) y se ajustó la bajada de cadera (`0.20`) para evitar recortes en cabeza o coletas en marcos compactos.

## [0.2.0] - 2026-11-15

### Added

- **Wayland Global Cursor & Active Window Bridge (ADR-0005)**: Puente D-Bus `org.deskumi.CursorBridge` con script automático en KDE Plasma (KWin 6) para seguimiento global del cursor (`LookAtSystem`) y geometría de la ventana activa incluso sobre regiones click-through o ventanas nativas de Wayland.
- **Interacción con ventanas y pose sentada**: Modo opcional para posar y sentar al avatar proceduralmente sobre la barra de título de la ventana activa (con piernas colgando, reducción dinámica de la caja al 72% de alto y retorno automático a posición parada al cerrar, minimizar o alcanzar el borde superior).
- **Ventana de ajustes responsiva y vista previa dinámica**: Rediseño responsivo del panel de ajustes y área de vista previa (`PreviewStage`) adaptable al ancho/alto y escala del avatar sin recortar el modelo.

### Changed

- **Targets de empaquetado**: Se mantiene la generación de paquetes `.deb`, `.rpm` y `.exe` (NSIS) y se elimina el target `.AppImage` debido a problemas de refresco de frames duplicados en capas.

### Fixed

- **Silueta y click-through**: Ajustes en el cálculo de región de entrada (`input_region`) y posicionamiento de ventana para evitar bloqueos y mejorar la fluidez de seguimiento.

## [0.1.1] - 2026-11-12

### Fixed

- **WebGL Ghosting / Framebuffer Clear**: Se configuró `premultipliedAlpha: false`, `autoClear: true` y llamada explícita a `this.renderer.clear()` en `SceneManager.ts` para eliminar artefactos y estelas de frames anteriores durante animaciones procedurales en ventanas transparentes.
- **RPM Dependencies en Fedora/RHEL**: Se corrigió el nombre del paquete de dependencia de bandeja en `tauri.conf.json` de `libayatana-appindicator` a `libappindicator-gtk3`, resolviendo el fallo de instalación con `dnf install`.

## [0.1.0] - 2026-11-12

### Added

- Bundles Linux y targets de empaquetado (T-501): Metadatos completos de empaquetado en `src-tauri/tauri.conf.json` (`shortDescription`, `longDescription`, `category: Utility`, `copyright`), targets multi-distribución (`.deb`, `.rpm`, `.AppImage`) y declaración de dependencias de sistema (WebKit2GTK 4.1, Ayatana AppIndicator, librsvg, libxdo).
- Build Windows y compilación multiplataforma en CI (T-502): Configuración de instalador NSIS para Windows en `tauri.conf.json` y job matricial `build-release` en `.github/workflows/ci.yml` ejecutando compilaciones automáticas en `ubuntu-22.04` (bundles Linux deb/appimage) y `windows-latest` (bundle Windows NSIS/.exe).

- Soporte para animaciones retargeteables `.vrma` (`@pixiv/three-vrm-animation`) y selector (T-404): `VRMAPlayer` para carga y reproducción de animaciones `.vrma` con `THREE.AnimationMixer`, crossfading (`fadeIn`/`fadeOut`), modo loop y one-shot, lectura de archivos locales en runtime Tauri, selector nativo en System Tray (`Cargar animación (.vrma)...` y `Detener animación (.vrma)`), persistencia de `vrmaPath` en `settings.json`, y pausa de idle procedural en `AnimationSystem` durante la reproducción.
- Ventana secundaria de ajustes (T-407): Ventana nativa bajo demanda (460x540 px) abrible desde el System Tray ("Ajustes...") y mediante comando Tauri IPC `open_settings_window`, panel de configuración en Vanilla TypeScript + CSS Custom Properties (`settings.html` + `SettingsPanel.ts`), persistencia en `tauri-plugin-store` y sincronización en tiempo real con la ventana principal mediante evento Tauri `"settings-updated"` (avatar, escala 0.5x-2.0x, límite 15/30/60 FPS y restablecimiento de posición).

- Dynamic click-through input region bridge (T-303): comando IPC en Rust `set_input_region` con `cairo::Region` y `gtk::WidgetExt::input_shape_combine_region` despachado en el hilo principal (`run_on_main_thread`), servicio TypeScript `InputRegionManager` con throttling (~15 Hz) y deduplicación, cálculo proyectado de silueta/bounding box y `AvatarInputRegionSystem` en `src/main.ts`.

- `LookAtSystem` para seguimiento visual y rotación anatómica de cabeza y cuello con el puntero del mouse (`vrm.lookAt`, clamping a ±30°, interpolación suave por lerp damping y retorno automático a la posición frontal neutra al salir de la ventana o tras inactividad) (T-301).
- AnimationSystem y BlinkController para animación idle procedural (respiración en columna, balanceo sutil de cadera y relajación de brazos a A-pose), máquina de estados para parpadeo aleatorio y simulación continua de spring bones (`vrm.update(dt)`) con carga del avatar oficial de muestra en `src/main.ts` (T-204).
- SceneManager para Three.js con loop desacoplado, cálculo de delta time, FPS cap (30 FPS), pausa automática por visibilidad y gestión de subsistemas (T-201).
- Módulo `src/engine/AvatarLoader.ts` con carga de modelos VRM vía `GLTFLoader` y `VRMLoaderPlugin`, normalización y optimización de esqueletos/mallas (`combineSkeletons`, `removeUnnecessaryVertices`, rotación VRM 0.x), cálculo matemático de encuadre y centrado (`computeBounds`, `centerAndGround`, `scaleToHeight`, `calculatePerspectiveFraming`, `calculateOrthoFraming`) y liberación segura de recursos de GPU (`disposeVRM`) (T-202).
- Avatar oficial de muestra VRM 1.0 (`VRM1_Constraint_Twist_Sample.vrm`) verificado con licencia VRM Public License 1.0 y documentado en `CREDITS.md` (T-203).
- Ventana transparente sin decoraciones ni sombra, configurada en 400x600 con always-on-top y skip-taskbar (T-102).
- Workarounds de Linux para XWayland (`GDK_BACKEND=x11` salvo `DESKUMI_WAYLAND=1`) y prevención de fondo negro con WebKitGTK (`WEBKIT_DISABLE_DMABUF_RENDERER=1`) en `main.rs` (T-102).
- Comando IPC `get_platform_caps` y módulo de capacidades de plataforma (`platform.rs`, `caps.ts`, `ipc.ts`) detectando X11, XWayland y Wayland nativo (T-102).
- Escena de Three.js con cubo giratorio de prueba con `alpha: true`, `premultipliedAlpha: true` y fondo transparente (T-102).
- CI workflow endurecido en GitHub Actions con jobs paralelos para frontend (`npm check`), backend Rust (`cargo fmt`, `clippy`, `test`) y compilación Linux en `main`.
- Documentación de protección de ramas en `CONTRIBUTING.md` y badge de CI en `README.md`.
- Bootstrap del repositorio: documentación, ROADMAP, ADRs iniciales, reglas y skills
  para agentes, plantillas de GitHub, hooks de git y CI base.
