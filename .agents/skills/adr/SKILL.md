---
name: adr
description: >-
  Cómo redactar, numerar y cerrar Architecture Decision Records (ADR) en docs/adr/
  de Deskumi. Usar cuando una tarea requiera elegir entre alternativas técnicas,
  cambiar el stack o el contrato IPC, o al cerrar un spike.
---

# ADR

1. Siguiente número: `ls docs/adr | grep -E '^[0-9]{4}-' | sort | tail -1` → +1.
2. Copia `docs/adr/0000-template.md` → `docs/adr/NNNN-<slug-kebab>.md`.
3. Llena **Contexto** con hechos medibles (entorno, versiones, mediciones), no opiniones.
4. Al menos **2 opciones** reales con pros/contras.
5. **Decisión** en 1–2 frases. **Consecuencias** incluye qué docs/código/tareas cambian.
6. **Evidencia**: comandos ejecutados, resultados, enlaces a issues upstream.
7. Estado inicial `propuesta`. Pasa a `aceptada` solo con aprobación del usuario o
   coordinador (o al cerrar el spike que lo valida).
8. Enlaza el ADR desde `docs/ARCHITECTURE.md` (sección Decisiones).
9. Commit: `docs(adr): propose ADR-NNNN <slug>` / `docs(adr): accept ADR-NNNN <slug>`.

Nunca edites la decisión de un ADR aceptado: crea uno nuevo que lo reemplace y cambia
el estado del viejo a `reemplazada por ADR-XXXX`.
