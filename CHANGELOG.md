# Changelog

Todos los cambios notables se documentan aquí.
Formato: [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) ·
Versionado: [SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Added

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
