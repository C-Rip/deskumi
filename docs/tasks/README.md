# Tarjetas de tareas

Cada archivo `T-XXX-*.md` es una unidad de trabajo para **un agente, una rama, un PR**.
Solo existen tarjetas para tareas "listas" (🟦 en el [ROADMAP](../ROADMAP.md)); las
demás se detallan cuando se acerca su fase (usa la skill `task-workflow` → "Crear tarjeta").

## Ciclo de vida
```mermaid
stateDiagram-v2
  [*] --> lista
  lista --> en_progreso: agente reclama (en su rama)
  en_progreso --> en_revision: abre PR
  en_revision --> en_progreso: cambios pedidos
  en_revision --> hecha: merge a main
  en_progreso --> bloqueada: dependencia o duda
  bloqueada --> en_progreso
  hecha --> [*]
```

## Plantilla
Copia [`_TEMPLATE.md`](_TEMPLATE.md).
