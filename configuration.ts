import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Binding, ReceiverError, SessionId } from "./schema.ts";

export function agentDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  return environment["PI_CODING_AGENT_DIR"] ??
    environment["OMO_CODING_AGENT_DIR"] ??
    environment["SENPI_CODING_AGENT_DIR"] ??
    join(homedir(), ".pi", "agent");
}

export async function loadBinding(directory: string, sessionId: string): Promise<Binding | undefined> {
  const path = join(directory, "primitive-receiver", "bindings", `${SessionId.parse(sessionId)}.json`);
  try {
    const binding = Binding.parse(JSON.parse(await readFile(path, "utf8")));
    if (binding.sessionId !== sessionId) throw new ReceiverError("binding_identity_mismatch");
    return binding;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function saveBinding(directory: string, binding: Binding): Promise<void> {
  const root = join(directory, "primitive-receiver", "bindings");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, `${binding.sessionId}.json`);
  await writeFile(`${path}.tmp`, JSON.stringify(binding), { mode: 0o600, flush: true });
  await rename(`${path}.tmp`, path);
}
