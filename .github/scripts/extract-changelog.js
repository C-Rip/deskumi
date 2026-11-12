import console from "node:console";
import fs from "node:fs";
import process from "node:process";

/**
 * Extracts release notes from CHANGELOG markdown content for a given tag.
 *
 * @param {string} content The raw markdown content of CHANGELOG.md
 * @param {string} tag The tag name, e.g. "v0.1.0" or "0.1.0"
 * @returns {string} The extracted markdown notes
 */
export function extractChangelog(content, tag) {
  const version = (tag || "").replace(/^v/, "").trim();
  const lines = (content || "").split(/\r?\n/);

  // Escaped version for regex matching, e.g. "0.1.0" -> "0\\.1\\.0"
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const versionRegex = new RegExp(`^##\\s+\\[?v?${escapedVersion}\\]?`, "i");

  let capturing = false;
  const result = [];

  for (const line of lines) {
    if (capturing) {
      if (/^##\s+/.test(line)) {
        break;
      }
      result.push(line);
    } else if (version && versionRegex.test(line)) {
      capturing = true;
    }
  }

  const trimmed = result.join("\n").trim();
  if (trimmed.length > 0) {
    return trimmed;
  }

  // Fallback: If tagged version heading does not exist, extract [Unreleased]
  capturing = false;
  const unreleasedResult = [];

  for (const line of lines) {
    if (capturing) {
      if (/^##\s+/.test(line)) {
        break;
      }
      unreleasedResult.push(line);
    } else if (/^##\s+\[Unreleased\]/i.test(line)) {
      capturing = true;
    }
  }

  const unreleasedTrimmed = unreleasedResult.join("\n").trim();
  if (unreleasedTrimmed.length > 0) {
    return unreleasedTrimmed;
  }

  return `Release ${tag || "unknown"}`;
}

export function main() {
  const changelogPath = process.argv[2] || "CHANGELOG.md";
  const tag =
    process.argv[3] || process.env.GITHUB_REF_NAME || process.env.TAG || "";

  if (!fs.existsSync(changelogPath)) {
    console.error(`Changelog file not found at: ${changelogPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(changelogPath, "utf8");
  const notes = extractChangelog(content, tag);

  console.log(notes);

  // Write release-notes.md for safe use in GitHub CLI without shell escaping
  fs.writeFileSync("release-notes.md", notes, "utf8");

  if (process.env.GITHUB_OUTPUT) {
    const delimiter = `EOF_${Math.random().toString(36).slice(2)}`;
    const output = `notes<<${delimiter}\n${notes}\n${delimiter}\n`;
    fs.appendFileSync(process.env.GITHUB_OUTPUT, output, "utf8");
  }
}

// Check if running as main script
const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("extract-changelog.js") ||
    process.argv[1].endsWith("extract-changelog.mjs"));

if (isMainModule) {
  main();
}
