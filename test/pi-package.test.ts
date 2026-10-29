import { afterEach, describe, expect, test } from "bun:test";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ));
});

describe("upstream Pi package compatibility", () => {
  test("loads the package through the real upstream resource loader", async () => {
    // Given: isolated Pi state, with no owner's settings or credentials.
    const directory = await mkdtemp(join(tmpdir(), "pp-upstream-"));
    directories.push(directory);
    const root = fileURLToPath(new URL("../", import.meta.url));
    const loader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager: SettingsManager.inMemory(),
      additionalExtensionPaths: [root],
      noContextFiles: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    });
    // When
    await loader.reload();
    // Then
    const result = loader.getExtensions();
    expect(result.errors).toEqual([]);
    const extension = result.extensions.find(
      (candidate) => candidate.resolvedPath === join(root, "index.ts"),
    );
    expect(extension?.commands.has("primitive-connect")).toBe(true);
    expect(extension?.commands.has("primitive-status")).toBe(true);
    expect(extension?.handlers.has("session_start")).toBe(true);
    expect(extension?.handlers.has("session_shutdown")).toBe(true);
  }, 15_000);
});
