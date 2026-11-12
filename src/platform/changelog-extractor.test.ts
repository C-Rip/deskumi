import { describe, expect, it } from "vitest";
import { extractChangelog } from "../../.github/scripts/extract-changelog.js";

describe("extractChangelog", () => {
  const sampleChangelog = `# Changelog

Todos los cambios notables se documentan aquí.

## [Unreleased]

### Added
- Unreleased feature 1
- Unreleased feature 2

## [0.1.0] - 2026-11-12

### Added
- Initial release with 3D VRM support
- Transparent desktop window
- System tray integration

### Fixed
- Fixed window border artifacts

## [0.0.1] - 2026-11-01

### Added
- Scaffold project
`;

  it("extracts notes for an exact semver tag with v prefix", () => {
    const notes = extractChangelog(sampleChangelog, "v0.1.0");
    expect(notes).toContain("### Added");
    expect(notes).toContain("- Initial release with 3D VRM support");
    expect(notes).toContain("### Fixed");
    expect(notes).not.toContain("Unreleased feature 1");
    expect(notes).not.toContain("Scaffold project");
  });

  it("extracts notes for an exact semver tag without v prefix", () => {
    const notes = extractChangelog(sampleChangelog, "0.1.0");
    expect(notes).toContain("- Initial release with 3D VRM support");
    expect(notes).not.toContain("Unreleased feature 1");
    expect(notes).not.toContain("Scaffold project");
  });

  it("extracts notes for an older version", () => {
    const notes = extractChangelog(sampleChangelog, "v0.0.1");
    expect(notes).toContain("- Scaffold project");
    expect(notes).not.toContain("Initial release with 3D VRM support");
  });

  it("falls back to [Unreleased] when version tag is not yet in changelog", () => {
    const notes = extractChangelog(sampleChangelog, "v0.2.0");
    expect(notes).toContain("Unreleased feature 1");
    expect(notes).not.toContain("Initial release with 3D VRM support");
  });

  it("returns fallback message if neither version nor unreleased exists", () => {
    const emptyChangelog = `# Changelog\n\nNo sections yet.`;
    const notes = extractChangelog(emptyChangelog, "v1.0.0");
    expect(notes).toBe("Release v1.0.0");
  });

  it("handles empty or missing content gracefully", () => {
    const notes = extractChangelog("", "v1.0.0");
    expect(notes).toBe("Release v1.0.0");
  });
});
