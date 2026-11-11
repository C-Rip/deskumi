---
trigger: model_decision
description: Reglas de documentación. Aplicar al editar archivos en docs/, README, CHANGELOG, AGENTS.md o al tomar una decisión técnica relevante.
---

# Reglas: Documentación

- `docs/ROADMAP.md` es el tablero: actualiza el estado de tu tarea (🟨 al empezar, ✅ al mergear).
- Toda decisión que cambie stack, contrato IPC, estructura o estrategia de plataforma
  → ADR nuevo en `docs/adr/` (skill `adr`). No reescribas ADRs aceptados: créalos
  nuevos con "reemplaza a ADR-XXXX".
- `CHANGELOG.md`: agrega una línea en `[Unreleased]` por cada cambio visible para el
  usuario (Added / Changed / Fixed / Removed).
- Diagramas en Mermaid (flowchart, sequence, state). Nada de imágenes de diagramas.
- Enlaces relativos dentro del repo. Nunca rutas absolutas de una máquina.
- Mantén `AGENTS.md` < 8 KB: los detalles van en rules/skills, no ahí.
