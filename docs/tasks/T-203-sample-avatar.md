# T-203: Avatar de ejemplo con licencia verificada

| Campo         | Valor                                              |
| ------------- | -------------------------------------------------- |
| Estado        | lista                                              |
| Asignado      | —                                                  |
| Fase          | F2                                                 |
| Rama          | `chore/T-203-sample-avatar`                        |
| Depende de    | —                                                  |
| Estimación    | S                                                  |
| Skills útiles | `task-workflow`, `git-workflow`                    |

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
- [ ] Modelo `.vrm` disponible en `assets/avatars/`.
- [ ] Licencia verificada y documentada en `assets/CREDITS.md`.
- [ ] Formato y git status limpios.

## Verificación
```bash
test -f assets/avatars/*.vrm && grep -q "assets/avatars" assets/CREDITS.md
```
