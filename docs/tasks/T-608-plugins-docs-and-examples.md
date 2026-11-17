# T-608: Documentación, esquemas JSON, ejemplos MIT, QA hostil y skill `plugin-authoring`

| Campo         | Valor                                            |
| ------------- | ------------------------------------------------ |
| Estado        | lista                                            |
| Asignado      | —                                                |
| Fase          | F6                                               |
| Rama          | `docs/T-608-plugins-docs-and-examples`           |
| Depende de    | T-603, T-604, T-605, T-606, T-607                |
| Estimación    | M (≤ 1 día)                                      |
| Skills útiles | `task-workflow`, `git-workflow`, `documentation` |

## Objetivo

Publicar la documentación oficial de plugins y puente WebSocket (`docs/PLUGINS.md`), esquemas JSON formales de contrato, ejemplos bajo licencia MIT (`examples/LICENSE` + `examples/plugins/hello-companion/`), pruebas F6 de seguridad/soak en `docs/QA.md` y la skill `plugin-authoring` para futuros agentes y autores.

## Contexto

- [ADR-0006](../adr/0006-plugins-and-local-ws-bridge.md): Especificación congelada del protocolo `v: 1`, aislamiento `plugin://` + `<iframe sandbox="allow-scripts">` y presupuesto RAM/CPU.
- [phase-6-plan-v4-review.md](../plans/phase-6-plan-v4-review.md) (§6 sobre plugin hostil + prueba de 3 estados en WebKitGTK real, §7 sobre licencia permisiva MIT en `examples/` para no imponer GPLv3 a scripts externos de usuarios).

## Alcance

- Incluye:
  - `examples/LICENSE` con texto estándar de licencia MIT aplicable al contenido bajo `examples/` (clarificado también en `docs/PLUGINS.md`).
  - `examples/plugins/hello-companion/`:
    - `manifest.json`, `index.html`, `main.js`, `README.md`.
    - Ejemplo mínimo funcional que reacciona a `click` (`"head"` / `"body"`), cambia expresión (`happy` / `surprised`) y muestra saludo vía `say` bajo la CSP estricta de `plugin://`.
  - `docs/schemas/`:
    - `avatar-command.schema.json` (sobres `v: 1`, límites numéricos exactos, sin `audio.url`).
    - `avatar-event.schema.json` (`click`, `speechStart`, `speechEnd` con `reason`, `idleChange`, `avatarChange`, `windowFocus`).
    - `plugin-manifest.schema.json` (`id`, `name`, `version`, `entry`, `permissions`, `animations`).
  - `docs/PLUGINS.md`: guía completa para autores de plugins y clientes WebSocket externos (lectura atómica de `bridge.json`, protocolo binario de `speakChunk`, manejo de `ack`/`error`, modelo de permisos, registro de `.vrma` y licencia MIT de ejemplos).
  - Ampliación de `docs/QA.md` con matriz F6:
    - Caso de **plugin hostil** ejecutado en WebKitGTK real intentando `fetch`, `import()` remoto, `WebSocket`, `new Worker(blob)` y lectura de `window.parent` / `__TAURI__` (todos bloqueados con 0 tráfico TCP saliente).
    - Medición de **presupuesto en 3 estados** (puente apagado; puente + 1 plugin en reposo; stream continuo de 10 min + 1 min después verificando retorno a 10 FPS y `AudioContext.state === "suspended"`).
    - Verificación de `windowFocus` en E1 (GNOME) y E2 (KDE Nobara).
  - `.agents/skills/plugin-authoring/SKILL.md`: guía práctica para agentes que creen plugins o integraciones externas en el repo.
- **No incluye:** cambios de código runtime en `src/` o `src-tauri/`.

## Pasos sugeridos

1. Crear `examples/LICENSE` (MIT) y `examples/plugins/hello-companion/` validándolo manualmente dentro de Deskumi.
2. Escribir los tres esquemas JSON en `docs/schemas/` verificando que coinciden exactamente con `src/engine/AvatarCommand.ts` y `src-tauri/src/plugins.rs`.
3. Redactar `docs/PLUGINS.md` y `.agents/skills/plugin-authoring/SKILL.md`.
4. Añadir los casos F6 en `docs/QA.md` y ejecutar la pasada manual en E1 (y E2 si disponible) registrando resultados.

## Criterios de aceptación

- [ ] `examples/LICENSE` es MIT y `examples/plugins/hello-companion/` funciona sin errores CSP dentro de Deskumi.
- [ ] `docs/schemas/*.json` reflejan fielmente el contrato `v: 1` implementado en `T-602..T-606`.
- [ ] `docs/PLUGINS.md` y `.agents/skills/plugin-authoring/SKILL.md` documentan contrato, límites y modelo de seguridad sin enlaces rotos.
- [ ] `docs/QA.md` incluye la prueba de plugin hostil en WebKitGTK real y la medición de presupuesto en 3 estados.
- [ ] `npm run check` pasa limpio (incluyendo Prettier sobre JSON y Markdown).

## Archivos esperados

- `examples/LICENSE` — crear
- `examples/plugins/hello-companion/*` — crear
- `docs/schemas/avatar-command.schema.json` — crear
- `docs/schemas/avatar-event.schema.json` — crear
- `docs/schemas/plugin-manifest.schema.json` — crear
- `docs/PLUGINS.md` — crear
- `docs/QA.md` — ampliar con casos F6
- `.agents/skills/plugin-authoring/SKILL.md` — crear

## Verificación

```bash
npm run check
(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)
```

## Handoff

_Lo llena el agente al terminar: qué quedó, decisiones tomadas, deuda, siguientes pasos, entorno probado._
