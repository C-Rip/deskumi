# ADR-0004: Ventana de Ajustes en Vanilla TypeScript + CSS Custom Properties

- **Estado:** Aceptado
- **Fecha:** 2026-11-12
- **Autor(es):** crivera + @settings-407
- **Tarea relacionada:** T-407

## Contexto

Deskumi requiere una segunda ventana (`label: "settings"`) para que el usuario pueda configurar las opciones de su mascota de escritorio de forma visual y cómoda sin editar archivos JSON ni depender únicamente de menús contextuales del System Tray:

- Selección y eliminación del modelo de avatar (`.vrm`).
- Escala del avatar (`avatarScale`: `0.5x` a `2.0x`).
- Límite de fotogramas por segundo (`fpsCap`: `15`, `30`, `60` FPS).
- Restablecimiento de la posición de la ventana en pantalla.

En `AGENTS.md` y [ADR-0001](0001-tauri-v2-threejs-vrm.md) se definió que la ventana principal del personaje no usa frameworks de UI y que cualquier panel de configuración futuro en una segunda ventana requería un ADR para decidir el enfoque de interfaz.

## Opciones consideradas

1. **Vanilla TypeScript + CSS Custom Properties en configuración multi-página de Vite (`settings.html` + `src/settings/main.ts`)** abierta bajo demanda como segunda `WebviewWindow` (`label: "settings"`).
   - Pros: Cero dependencias nuevas en `package.json`, impacto despreciable en el tamaño del binario (< 15 MB), consumo mínimo de RAM y destrucción completa del WebView al cerrar la ventana de ajustes (creada bajo demanda).
   - Contras: Construcción imperativa/declarativa manual del DOM, que para un panel de ~4 secciones es sencilla y fácil de mantener y testear con Vitest.

2. **Preact / SolidJS / Svelte en la segunda ventana.**
   - Pros: Componentes reactivos declarativos.
   - Contras: Introduce dependencias adicionales de runtime y plugins de compilación en Vite (`@preact/preset-vite` o `@sveltejs/vite-plugin-svelte`), incrementa la superficie de mantenimiento y resulta innecesario para un formulario de ajustes acotado.

3. **React / Vue 3.**
   - Pros: Ecosistema amplio.
   - Contras: Peso desproporcionado para una ventana de configuración simple, contradiciendo la filosofía ultraligera de Deskumi.

## Decisión

Adoptar la **Opción 1: Vanilla TypeScript + CSS Custom Properties** en una configuración multi-página de Vite (`index.html` para la ventana `"main"` y `settings.html` para la ventana `"settings"`), instanciando la ventana `"settings"` bajo demanda desde Rust mediante `WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))`.

Cuando el usuario modifica cualquier ajuste en la ventana `"settings"`, el cambio se persiste mediante `defaultConfigManager` (`tauri-plugin-store`) y se emite el evento Tauri `"settings-updated"` con el payload completo de `AppConfig` para que la ventana `"main"` aplique los cambios (`fpsCap`, `avatarScale`, `avatarPath`, posición) en tiempo real.

## Consecuencias

- **Positivas:**
  - Cero dependencias adicionales de npm ni de Cargo.
  - Presupuesto de binario (< 15 MB) y memoria RAM intactos: mientras la ventana de ajustes está cerrada no existe segundo WebView en memoria.
  - Lógica del panel (`SettingsPanel`) desacoplada y 100% testeable de forma unitaria en Vitest.
  - Sincronización reactiva e inmediata con la ventana `"main"` mediante eventos IPC de Tauri (`"settings-updated"`).
- **Negativas:**
  - Si en fases futuras (F6+) la interfaz de configuración crece a decenas de vistas complejas, podría reevaluarse un micro-framework; para el alcance de v0.1, Vanilla TS es óptimo.
