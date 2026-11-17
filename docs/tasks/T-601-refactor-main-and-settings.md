# T-601: Refactor puro — dividir `src/main.ts` y `src/settings/SettingsPanel.ts`

| Campo         | Valor                                    |
| ------------- | ---------------------------------------- |
| Estado        | lista                                    |
| Asignado      | —                                        |
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

- [ ] `src/main.ts`, `src/settings/SettingsPanel.ts` y los nuevos módulos extraídos tienen ≤ 300 líneas cada uno.
- [ ] Ninguna regla de `.agents/rules/frontend-threejs.md` se rompe (`src/engine/**` intacto).
- [ ] `npm run check` pasa con todos los tests existentes sin regresiones.
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

_Lo llena el agente al terminar: qué quedó, decisiones tomadas, deuda, siguientes pasos, entorno probado._
