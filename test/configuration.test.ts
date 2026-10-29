import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentDirectory, loadBinding, saveBinding } from "../configuration.ts";
import { Binding, ReceiverError } from "../schema.ts";

const binding = Binding.parse({
  sessionId: "11111111-1111-4111-8111-111111111111",
  profile: "private-profile",
  address: "agent@example.com",
  contactRequests: false,
});
const directories: string[] = [];

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "pp-config-"));
  directories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(
    (path) => rm(path, { recursive: true, force: true }),
  ));
});

describe("portable private session configuration", () => {
  test("uses the harness-provided agent directory", () => {
    // Given
    const environments = [
      { PI_CODING_AGENT_DIR: "/pi-agent" },
      { OMO_CODING_AGENT_DIR: "/omo-agent" },
      { SENPI_CODING_AGENT_DIR: "/senpi-agent" },
    ];
    // When
    const selected = environments.map((environment) => agentDirectory(environment));
    // Then
    expect(selected).toEqual(["/pi-agent", "/omo-agent", "/senpi-agent"]);
  });

  test("stores the binding privately outside the package", async () => {
    // Given
    const root = await directory();
    // When
    await saveBinding(root, binding);
    // Then
    expect(await loadBinding(root, binding.sessionId)).toEqual(binding);
    const path = join(root, "primitive-receiver", "bindings", `${binding.sessionId}.json`);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(Object.keys(JSON.parse(await readFile(path, "utf8")))).toEqual(
      ["sessionId", "profile", "address", "contactRequests"],
    );
  });

  test("does not inherit another session's address", async () => {
    // Given
    const root = await directory();
    await saveBinding(root, binding);
    // When
    const other = await loadBinding(root, "22222222-2222-4222-8222-222222222222");
    // Then
    expect(other).toBeUndefined();
  });

  test("rejects a binding stored under the wrong session identity", async () => {
    // Given
    const root = await directory();
    await saveBinding(root, binding);
    const otherId = "22222222-2222-4222-8222-222222222222";
    await writeFile(
      join(root, "primitive-receiver", "bindings", `${otherId}.json`),
      JSON.stringify(binding),
      { mode: 0o600 },
    );
    // When
    const other = loadBinding(root, otherId);
    // Then
    await expect(other).rejects.toBeInstanceOf(ReceiverError);
  });
});
