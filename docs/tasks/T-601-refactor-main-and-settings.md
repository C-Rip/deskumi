# T-601: Refactor puro — dividir `src/main.ts` y `src/settings/SettingsPanel.ts`

| Campo         | Valor                                    |
| ------------- | ---------------------------------------- |
| Estado        | en revisión                              |
| Asignado      | Frontend Refactor Engineer               |
| Fase          | F6                                       |
| Rama          | `refactor/T-601-split-main-and-settings` |
| Depende de    | —                                        |
| Estimación    | M (≤ 1 día)                              |
| Skills útiles | `task-workflow`, `git-workflow`          |

## Objetivo

Dividir `src/main.ts` (500 líneas) y `src/settings/SettingsPanel.ts` (886 líneas) en módulos enfocados (< 300 líneas por archivo según `AGENTS.md`) **sin cambiar el comportamiento observable**, dejando la base lista y revisable para `T-602..T-607`.

## Contexto

- Regla de tamaño de archivo en [`AGENTS.md`](../../AGENTS.md).
- Señalado en [`phase-6-plan-v3-review.md`](../plans/phase-6-plan-v3-review.md) y [`phase-6-plan-v4-review.md`](../plans/phase-6-plan-v4-review.md) (§2).

## Alcance

- Incluye:
  - Extraer `src/platform/window-frame.ts` (`applyWindowFrameSize`, `applyAvatarTransform`).
  - Extraer `src/platform/app-listeners.ts` (listeners de eventos del tray, visibilidad de ajustes y `settings-updated`).
  - Reducir `src/main.ts` a < 260 líneas conservando sus exports (`sceneManager`, `debugOverlay`, `powerSaveController`, `windowPerchController`, `setActiveFps`).
  - Extraer `src/settings/SettingsTemplate.ts` (`buildSettingsHtml`) y `src/settings/SettingsPreviewController.ts` (guías, retícula SVG y drag vertical del preview).
  - Reducir `src/settings/SettingsPanel.ts` a < 300 líneas preservando su API pública y todos los tests existentes en `SettingsPanel.test.ts`.
- **No incluye:** nuevas funcionalidades de plugins, WebSocket, habla ni cambios en la lógica de animación o UI visual.

## Pasos sugeridos

1. Crear `src/platform/window-frame.ts` y `src/platform/app-listeners.ts` manteniendo tipos estrictos y sin `any`.
2. Conectar `src/main.ts` a los módulos extraídos verificando que no haya dependencias circulares ni cambios en los exports.
3. Crear `src/settings/SettingsTemplate.ts` y `src/settings/SettingsPreviewController.ts` y simplificar `src/settings/SettingsPanel.ts`.
4. Verificar que todos los archivos tocados o nuevos estén por debajo de ~300 líneas (`wc -l`).

## Criterios de aceptación

- [x] `src/main.ts`, `src/settings/SettingsPanel.ts` y los nuevos módulos extraídos tienen ≤ 300 líneas cada uno.
- [x] Ninguna regla de `.agents/rules/frontend-threejs.md` se rompe (`src/engine/**` intacto).
- [x] `npm run check` pasa con todos los tests existentes sin regresiones.
- [ ] Probado manualmente con `npm run tauri dev` (avatar, tray y ventana de ajustes funcionan igual).

## Archivos esperados

- `src/platform/window-frame.ts` — crear
- `src/platform/app-listeners.ts` — crear
- `src/main.ts` — modificar
- `src/settings/SettingsTemplate.ts` — crear
- `src/settings/SettingsPreviewController.ts` — crear
- `src/settings/SettingsPanel.ts` — modificar

## Verificación

```bash
wc -l src/main.ts src/platform/window-frame.ts src/platform/app-listeners.ts src/settings/SettingsPanel.ts src/settings/SettingsTemplate.ts src/settings/SettingsPreviewController.ts
npm run check
```

## Handoff

- **Qué quedó:**
  - `src/main.ts` reducido de 500 a 255 líneas conservando exactamente sus exports (`sceneManager`, `debugOverlay`, `powerSaveController`, `windowPerchController`, `setActiveFps`).
  - Extraído [`src/platform/window-frame.ts`](../../src/platform/window-frame.ts) (76 líneas): `applyWindowFrameSize`, `applyAvatarTransform`, `getEffectiveFrameSize` y `FrameSize`.
  - Extraído [`src/platform/app-listeners.ts`](../../src/platform/app-listeners.ts) (229 líneas): `setupAppListeners`, `AppRuntimeState` y `AppListenersDeps` para los 7 listeners IPC (`tray-request-load-avatar`, `tray-request-clear-avatar`, `tray-request-load-vrma`, `tray-request-stop-vrma`, `tray-autostart-changed`, `settings-window-visibility`, `settings-updated`).
  - `src/settings/SettingsPanel.ts` reducido de 886 a 298 líneas preservando su API pública completa y sin modificar [`src/settings/SettingsPanel.test.ts`](../../src/settings/SettingsPanel.test.ts).
  - Extraído [`src/settings/SettingsTemplate.ts`](../../src/settings/SettingsTemplate.ts) (189 líneas): `buildSettingsHtml` y `FRAME_PRESETS`.
  - Extraído [`src/settings/SettingsDom.ts`](../../src/settings/SettingsDom.ts) (208 líneas): referencias (`SettingsDomRefs`), consulta (`querySettingsDomRefs`), enlace de eventos (`bindSettingsDomEvents`) y sincronización DOM (`syncAvatarDom`, `syncScaleDom`, `syncFrameDom`, `syncFpsDom`, `syncSettingsDom`, `applyFeatureToggleDom`).
  - Extraído [`src/settings/SettingsPreviewController.ts`](../../src/settings/SettingsPreviewController.ts) (259 líneas): guías, botón `Pose Test`, retícula SVG de LookAt y drag vertical del preview.
  - `src/engine/**` y `docs/ROADMAP.md` permanecen intactos.
- **Decisiones tomadas:**
  - El estado mutable de bootstrap (`state: AppRuntimeState`) permanece en `src/main.ts` y se inyecta a `setupAppListeners` para respetar `.agents/rules/frontend-threejs.md` (sin estado global mutable fuera de `main.ts`).
  - Se extrajo [`src/settings/SettingsDom.ts`](../../src/settings/SettingsDom.ts) adicionalmente para separar el manejo DOM de la plantilla HTML (`SettingsTemplate.ts`) y del controlador (`SettingsPanel.ts`), manteniendo todos los módulos por debajo de 300 líneas sin compactación artificial.
  - `SettingsPreviewController` limpia sus listeners globales (`mousemove`/`mouseup` en `window`) en `mount()` y `dispose()`.
- **Verificación ejecutada:**
  - `npm run check` (`tsc --noEmit`, `eslint .`, `prettier --check .`, `vitest run`: 20 archivos, 187 tests pasando).
  - `npm run build` (`tsc && vite build` exitoso).
- **Deuda / Pendiente:**
  - Pendiente prueba manual interactiva con `npm run tauri dev` (avatar, tray y ventana de ajustes) en sesión gráfica de escritorio.
