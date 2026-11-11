# T-203: Avatar de ejemplo con licencia verificada

| Campo         | Valor                           |
| ------------- | ------------------------------- |
| Estado        | completada                      |
| Asignado      | worker-203                      |
| Fase          | F2                              |
| Rama          | `chore/T-203-sample-avatar`     |
| Depende de    | —                               |
| Estimación    | S                               |
| Skills útiles | `task-workflow`, `git-workflow` |

## Objetivo

Obtener un modelo 3D `.vrm` ligero y de alta compatibilidad con licencia abierta/permisiva explícita (ej. CC0, CC-BY o VRoid Hub con permisos completos de redistribución), ubicarlo en `assets/avatars/` y registrar todos sus metadatos y créditos en `assets/CREDITS.md`.

## Contexto

- [assets/CREDITS.md](../../assets/CREDITS.md)
- [AGENTS.md](../../AGENTS.md)
- [.agents/rules/documentation.md](../../.agents/rules/documentation.md)

## Alcance

- Incluye:
  - Seleccionar un avatar representativo (por ejemplo el modelo estándar oficial de muestra de Pixiv VRM como `VRM1_Constraint_Twist_Sample.vrm` o `AliciaSolid` / avatar CC0 de VRoid).
  - Verificar que su peso sea razonable (< 15-20 MB).
  - Agregar el archivo a `assets/avatars/` forzando el trackeo en git si está en .gitignore (`git add -f`).
  - Documentar autor, enlace de origen y licencia en `assets/CREDITS.md`.
- **No incluye:**
  - Código de animación (T-204).

## Criterios de aceptación

- [x] Modelo `.vrm` disponible en `assets/avatars/`.
- [x] Licencia verificada y documentada en `assets/CREDITS.md`.
- [x] Formato y git status limpios.

## Archivos esperados

- `assets/avatars/VRM1_Constraint_Twist_Sample.vrm` — modelo VRM 1.0 de muestra
- `assets/CREDITS.md` — registro de autoría, licencia y SHA256
- `CHANGELOG.md` — registro en `[Unreleased]`
- `docs/tasks/T-203-sample-avatar.md` — tarjeta de tarea actualizada

## Verificación

```bash
test -f assets/avatars/*.vrm && grep -q "assets/avatars" assets/CREDITS.md
```

## Handoff

### Implementado

- Modelo oficial VRM 1.0 `VRM1_Constraint_Twist_Sample.vrm` descargado desde el repositorio oficial `vrm-c/vrm-specification` e integrado en `assets/avatars/` mediante `git add -f`.
  - Peso: 10,776,032 bytes (~10.27 MB, dentro del límite de < 15-20 MB).
  - SHA256: `12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2`.
  - Licencia verificada: `VRM Public License 1.0` (https://vrm.dev/licenses/1.0/).
  - Metadatos validados en GLB chunk: `allowRedistribution: true`, `commercialUsage: "corporation"`, `creditNotation: "unnecessary"`, `modification: "allowModificationRedistribution"`, `authors: ["pixiv Inc."]`.
- Documentación completa en `assets/CREDITS.md` con enlace al repositorio de origen, licencia y notas detalladas.
- Actualizado `CHANGELOG.md` en sección `[Unreleased]`.

### Siguiente tarea relacionada

- `T-202` (Carga y renderizado de avatar VRM) y `T-204` (Animaciones idle/básicas) pueden usar directamente `assets/avatars/VRM1_Constraint_Twist_Sample.vrm` como modelo de prueba representativo con soporte completo de morph targets, spring bones y constraints VRM 1.0.
