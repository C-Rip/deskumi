# T-503: Workflow de release por tag v* con artefactos y CHANGELOG

| Campo         | Valor                                              |
| ------------- | -------------------------------------------------- |
| Estado        | en revisión                                        |
| Asignado      | releaser                                           |
| Fase          | F5                                                 |
| Rama          | `feat/T-503-release-workflow`                      |
| Depende de    | T-501                                              |
| Estimación    | S                                                  |
| Skills útiles | `git-workflow`, `dev-environment`, `task-workflow` |

## Objetivo

Automatizar la generación y publicación de GitHub Releases a partir del push de tags de versión (`v*`), compilando los instaladores y paquetes binarios para Linux y Windows mediante `tauri-apps/tauri-action@v0`, extrayendo automáticamente las notas de versión desde `CHANGELOG.md` y adjuntando las sumas criptográficas SHA256 para verificación de integridad.

## Contexto

En el ciclo de distribución de Deskumi (Fase 5), las nuevas versiones se marcan mediante tags semver (`vX.Y.Z`). El proceso de publicación requiere compilar los paquetes nativos en Linux (`.deb`, `.AppImage`, `.rpm`) y en Windows (`.msi`, `.exe`), generar un release oficial en GitHub con el changelog asociado a la versión, y publicar los checksums de cada instalador.

## Alcance

- Incluye:
  - Creación del workflow `.github/workflows/release.yml` disparado en tags `v[0-9]+.[0-9]+.[0-9]+*`.
  - Matriz de compilación y empaquetado para `ubuntu-22.04` y `windows-latest` usando `tauri-apps/tauri-action@v0`.
  - Script utilitario de extracción de notas de release desde `CHANGELOG.md` (`.github/scripts/extract-changelog.js`) con soporte para formato Keep a Changelog y fallback a `[Unreleased]`.
  - Tests unitarios en Vitest para la lógica de extracción de changelog (`src/platform/changelog-extractor.test.ts`).
  - Generación automática de checksums SHA256 (`.sha256` individuales y `SHA256SUMS-<platform>.txt` consolidados) y subida a GitHub Release vía GitHub CLI (`gh release upload`).
  - Sincronización de notas de versión en el release publicado.
- **No incluye:** Firma de código comercial Authenticode/EV en Windows o repositorios externos PPA/COPR (post v0.1).

## Criterios de aceptación

- [x] Workflow `.github/workflows/release.yml` creado con disparador `push: tags: ['v[0-9]+.[0-9]+.[0-9]+*']`.
- [x] Matriz de ejecución con `ubuntu-22.04` y `windows-latest`.
- [x] Acción oficial `tauri-apps/tauri-action@v0` integrada con token de GitHub y permisos de escritura en contenidos.
- [x] Extracción automática de notas de versión desde `CHANGELOG.md` para el tag disparador.
- [x] Generación y subida de artefactos de release (`.deb`, `.AppImage`, `.rpm`, `.msi`, `.exe`) y sumas SHA256 de verificación.
- [x] Suite de pruebas y validación de formato ejecutada limpiamente (`npm run format:check` y `npm run test`).

## Archivos esperados

- `.github/workflows/release.yml` — Workflow de GitHub Actions para releases.
- `.github/scripts/extract-changelog.js` — Script extractor de secciones de CHANGELOG.md.
- `src/platform/changelog-extractor.test.ts` — Tests unitarios de extracción de changelog.
- `docs/tasks/T-503-release-workflow.md` — Tarjeta de tarea.

## Verificación

```bash
# Validar sintaxis YAML
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"

# Probar script extractor
node .github/scripts/extract-changelog.js CHANGELOG.md v0.1.0

# Ejecutar tests unitarios y linter/formateador
npm run format:check
npm run test
```

## Handoff

### Qué se hizo

- **`.github/workflows/release.yml`:**
  - Se configuró el disparador por push de tags semver (`v[0-9]+.[0-9]+.[0-9]+*`).
  - Se definió la matriz de compilación para `ubuntu-22.04` y `windows-latest` con `fail-fast: false`.
  - Se añadieron dependencias de sistema completas para Linux (WebKit2GTK 4.1, Ayatana AppIndicator, librsvg2, libxdo, patchelf, libfuse2 para AppImage, y rpm para `.rpm`).
  - Se integró `tauri-apps/tauri-action@v0` para compilar y publicar la versión en GitHub Releases con soporte para pre-releases y assets nativos.
  - Se implementó la generación de checksums SHA256 para todos los artefactos empaquetados (`.sha256` y `SHA256SUMS-<platform>.txt`) con subida directa al release vía `gh release upload`.
  - Se configuró la sincronización de notas de release en GitHub a partir del markdown procesado.
- **`.github/scripts/extract-changelog.js`:**
  - Script ESM que analiza `CHANGELOG.md`, localiza la sección correspondiente al tag o versión semver, y provee fallback automático a `## [Unreleased]` si la cabecera aún no ha sido renombrada al momento del tag.
  - Exporta `notes` a `$GITHUB_OUTPUT` y genera `release-notes.md` localmente para evitar problemas de escape de caracteres en el shell.
- **`src/platform/changelog-extractor.test.ts`:**
  - 6 casos de prueba unitaria en Vitest cubriendo versiones con prefijo `v`, sin prefijo, versiones anteriores, fallbacks a unreleased y manejo de entradas vacías.
- **`docs/tasks/T-503-release-workflow.md`:**
  - Tarjeta de tarea creada y documentada según la plantilla del repositorio.

### Decisiones tomadas

- Se implementó el extractor como un script JavaScript ejecutable con Node.js estándar (sin requerir herramientas o transpiladores adicionales en los runners de CI), testeable con Vitest.
- Se calculan tanto archivos `.sha256` por binario como un archivo consolidado `SHA256SUMS-<platform>.txt` para máxima compatibilidad con usuarios y gestores de paquetes.
- Se utiliza `gh release upload` con `--clobber` para subir los checksums inmediatamente después de que `tauri-action` construye y sube los instaladores.

### Entorno probado

- Fedora 44 x86_64 (Linux).
- `node .github/scripts/extract-changelog.js CHANGELOG.md v0.1.0`: OK.
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"`: OK.
- `npm run check` (typecheck, lint, format:check, vitest): 170/170 tests pasados, 0 lints, 0 errores de formato.
