# ADR-0001: Usar Tauri v2 + Three.js + @pixiv/three-vrm

- **Estado:** aceptada
- **Fecha:** 2026-11-11
- **Autor(es):** crivera + agente
- **Tarea relacionada:** F0

## Contexto

Queremos una alternativa Linux-first al "Desktop Engine" de Steam (solo Windows).
Requisitos: multiplataforma (Linux GNOME/KDE, Windows), ventana transparente,
bajo consumo de RAM/disco, y que sea muy "vibecodeable" (stack que los LLMs
conocen bien).

## Opciones consideradas

1. **Electron + Three.js** — máxima compatibilidad y `setIgnoreMouseEvents({forward})`;
   pero ~150–300 MB de RAM y ~100 MB de instalador (trae Chromium).
2. **Tauri v2 + Three.js** — usa el WebView del sistema (WebKitGTK / WebView2):
   instalador de pocos MB, poca RAM, backend Rust para lo nativo. Contras: WebKitGTK
   tiene quirks de transparencia y WebGL algo más lento.
3. **Godot 4 + addon VRM** — buen motor y transparencia nativa; pero el ecosistema
   VRM es menos maduro, menos "vibecodeable" y ventanas/tray menos flexibles.
4. **Nativo (Rust + wgpu/Bevy)** — máximo rendimiento, pero cargar VRM (MToon,
   spring bones, expresiones) desde cero es meses de trabajo.

## Decisión

**Tauri v2** como shell + **Three.js** para render + **@pixiv/three-vrm** para avatares.
Frontend en **TypeScript vanilla** (sin framework de UI) para la ventana del personaje.

## Consecuencias

- Positivas: binario ligero, ecosistema VRM maduro (MToon, spring bones, expresiones,
  VRMA), mucho material de entrenamiento para agentes.
- Negativas: hay que lidiar con WebKitGTK (ver ADR-0003 y skill
  `linux-overlay-troubleshooting`); Tauri v1 vs v2 confunde a los LLMs → regla explícita
  en `AGENTS.md`.
- Dependencias de sistema en Linux: `webkit2gtk4.1-devel` (Fedora) /
  `libwebkit2gtk-4.1-dev` (Debian), ver skill `dev-environment`.
