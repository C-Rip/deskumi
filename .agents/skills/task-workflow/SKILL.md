---
name: task-workflow
description: >-
  Procedimiento para que un agente tome, ejecute, entregue o cree tarjetas de tareas
  de Deskumi (docs/tasks/T-XXX). Usar al inicio de cualquier trabajo de
  desarrollo, al terminar una tarea (handoff), o cuando se necesite detallar una tarea
  nueva del ROADMAP.
---

# Task workflow (agentes)

## A. Tomar una tarea

1. Abre `docs/ROADMAP.md`. Elige una tarea 🟦 cuyas dependencias estén ✅.
   Si te asignaron una concreta, verifica igual sus dependencias.
2. Lee la tarjeta `docs/tasks/T-XXX-*.md` completa, más los ADR y secciones que enlaza.
3. Crea rama + worktree (skill `git-workflow`):
   `bash .agents/skills/git-workflow/scripts/start-task.sh T-XXX <tipo> <slug>`
4. En tu worktree: tarjeta → `Estado: en progreso`, `Asignado: <tu nombre/ID>`;
   ROADMAP → 🟨. Primer commit: `docs(tasks): start T-XXX`.

## B. Ejecutar

- Respeta **Alcance → No incluye**. Si descubres trabajo extra, anótalo en Handoff
  como tarea sugerida; no lo hagas.
- Si una decisión no está cubierta por un ADR y afecta a otros módulos: detente,
  redacta un ADR "propuesta" (skill `adr`) y consulta al coordinador/usuario.
- Si estás bloqueado > 30 min por una duda de plataforma: consulta la skill
  `linux-overlay-troubleshooting`; si sigue, marca `Estado: bloqueada` con el motivo.
- Commits pequeños durante el trabajo (no un mega-commit al final).

## C. Entregar

1. Corre la verificación de la tarjeta y el Definition of Done de `AGENTS.md`.
2. Marca los criterios de aceptación cumplidos (`- [x]`).
3. Llena **Handoff** con:
   - Qué se hizo (bullets) y archivos clave.
   - Decisiones tomadas y por qué.
   - Entorno probado (E1..E4 de `docs/QA.md`, X11/Wayland).
   - Deuda técnica / TODOs / tareas sugeridas.
4. Tarjeta → `Estado: en revisión`. CHANGELOG `[Unreleased]` si aplica.
5. Abre PR (skill `git-workflow` §5) y reporta al coordinador: rama, resumen, riesgos.

## D. Crear una tarjeta nueva

1. Copia `docs/tasks/_TEMPLATE.md` → `docs/tasks/T-XXX-<slug>.md` (ID del ROADMAP).
2. Llena: objetivo, contexto con enlaces, alcance con **No incluye**, pasos,
   criterios verificables, archivos esperados, comandos de verificación.
3. Estimación máx. **L**. Si es mayor, divide la tarea y actualiza el ROADMAP.
4. Marca 🟦 en el ROADMAP. Commit: `docs(tasks): add T-XXX card`.

## Reglas de coordinación (varios agentes a la vez)

- Nunca trabajes en una tarea con `Asignado` de otro agente.
- No edites archivos "calientes" fuera de tu alcance (ver CONTRIBUTING).
- Un agente **verificador** puede revisar un PR con la checklist de
  `.github/pull_request_template.md` y dejar comentarios en el Handoff.
