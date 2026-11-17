# T-608: Documentación, esquemas JSON, ejemplos MIT, QA hostil y skill `plugin-authoring`

| Campo         | Valor                                            |
| ------------- | ------------------------------------------------ |
| Estado        | hecha                                            |
| Asignado      | subagent-T-608                                   |
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

- [ ] `examples/LICENSE` es MIT y `examples/plugins/hello-companion/` funciona sin errores CSP dentro de Deskumi. _(Licencia MIT verificada; HTML/JS libre de inline scripts, red o APIs privilegiadas, manifiesto validado contra `plugins.rs`, ESLint y `postMessage` `deskumi:plugin` verificados; pendiente pase interactivo GUI `Q-20` en WebKitGTK real.)_
- [x] `docs/schemas/*.json` reflejan fielmente el contrato `v: 1` implementado en `T-602..T-606`.
- [x] `docs/PLUGINS.md` y `.agents/skills/plugin-authoring/SKILL.md` documentan contrato, límites y modelo de seguridad sin enlaces rotos.
- [x] `docs/QA.md` incluye la prueba de plugin hostil en WebKitGTK real y la medición de presupuesto en 3 estados.
- [x] `npm run check` pasa limpio (incluyendo Prettier sobre JSON y Markdown).

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

- **Qué se hizo:**
  - Verificado [`examples/LICENSE`](../../examples/LICENSE) (MIT License) y creado el plugin de ejemplo MIT [`examples/plugins/hello-companion/`](../../examples/plugins/hello-companion/) (`manifest.json`, `index.html` limpio con `<script src="./main.js"></script>` sin scripts/estilos inline, `main.js` conectado al canal `deskumi:plugin` para `init`/`permissionsChanged`/`click` con `surprised` + `say` en `"head"` y `happy` + `say` en `"body"`, y `README.md` con instrucciones de instalación en `$APPDATA/plugins/hello-companion/`).
  - Creados los tres esquemas JSON Schema Draft 2020-12 en [`docs/schemas/`](../schemas/) alineados exactamente con `AvatarCommandSchema.ts`, `AvatarCommandValidator.ts`, `AvatarCommandFieldReaders.ts`, `AvatarCommandSpeechParsers.ts`, `plugins.rs` y `local_bridge.rs`:
    - [`docs/schemas/avatar-command.schema.json`](../schemas/avatar-command.schema.json)
    - [`docs/schemas/avatar-event.schema.json`](../schemas/avatar-event.schema.json)
    - [`docs/schemas/plugin-manifest.schema.json`](../schemas/plugin-manifest.schema.json)
  - Redactada la guía oficial [`docs/PLUGINS.md`](../PLUGINS.md) cubriendo arquitectura, aislamiento `plugin://` + `<iframe sandbox="allow-scripts">` y CSP, puente WebSocket local (`bridge.json`, anti-CSWSH sin `Origin`, token 256-bit, tramas binarias `DSK1` para `speakChunk`, códigos `ack`/`error`, topes de tasa y RAM), scopes (`desktop:events` vs `desktop:windowTitle`), registro lógico `.vrma`, aviso de licencias MIT/GPL/bancos de voz y recetas para VOICEVOX, Piper TTS, Kokoro-82M / `sherpa-onnx`, GPT-SoVITS y RVC.
  - Ampliado [`docs/QA.md`](../QA.md) con matriz F6 (`Q-18` a `Q-26`), procedimiento reproducible de plugin hostil en WebKitGTK real con listener TCP espía, prueba de presupuesto en 3 estados + soak de 10 minutos + retorno a 10 FPS y `AudioContext.state === "suspended"`, y verificación de `windowFocus` por scopes en E1 (GNOME) y E2 (KDE Nobara).
  - Creada la skill [`.agents/skills/plugin-authoring/SKILL.md`](../../.agents/skills/plugin-authoring/SKILL.md) para futuros agentes.
  - Actualizado [`CHANGELOG.md`](../../CHANGELOG.md) (`[Unreleased]`, resumiendo F6 sin duplicar `T-607`), marcado `T-608` como `✅` en [`docs/ROADMAP.md`](../ROADMAP.md) y cerrada la tarjeta.
- **Decisiones tomadas:**
  - En `docs/schemas/plugin-manifest.schema.json` se permitió opcionalmente `$schema` manteniendo `additionalProperties: false` para capturar errores de escritura en manifiestos sin romper validadores que referencian `$schema`.
  - En `docs/QA.md`, los casos nuevos `Q-18..Q-26` permanecen en estado `⬜` (y las mediciones de 3 estados como _Pendiente_) hasta ejecutarse el pase manual interactivo en escritorio E1 y E2.
  - No se modificó ningún archivo bajo `src/` ni `src-tauri/`.
- **Entorno probado / Verificación:**
  - Ejecutado en Linux (Fedora / worktree aislado sin sesión GUI abierta para `npm run tauri dev`).
  - `npx prettier --write examples/ docs/ .agents/skills/plugin-authoring/ CHANGELOG.md` aplicado sobre todos los entregables.
  - Validación de 38 enlaces relativos Markdown (0 enlaces rotos) y parseo + verificación de `$ref`/regex de los 3 esquemas JSON.
  - `npm run check` (`tsc --noEmit`, `eslint .`, `prettier --check .`, `vitest run`): 34 archivos / 260 tests en verde.
  - `(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)`: `fmt` limpio, `clippy` 0 warnings, 44 tests Rust en verde.
- **Deuda / siguientes pasos:**
  - Ejecutar el pase manual de `Q-18..Q-26` (especialmente plugin hostil `Q-18`, `hello-companion` `Q-20`, soak de 10 min en 3 estados `Q-25` y `windowFocus` `Q-23`/`Q-24` en E1 GNOME y E2 KDE Nobara) sobre `npm run tauri dev` y rellenar la tabla de `docs/QA.md`.
