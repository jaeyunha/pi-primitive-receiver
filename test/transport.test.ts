import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openEventSocket } from "../transport.ts";
import { ReceiverError } from "../schema.ts";

const EMAIL_ID = "11111111-1111-4111-8111-111111111111";
const EVENT = JSON.stringify({ event: "email.received", email: { id: EMAIL_ID } });
const sockets: Awaited<ReturnType<typeof openEventSocket>>[] = [];
const directories: string[] = [];

async function socket(deliver: (id: string) => Promise<void>) {
  // Keep temporary Unix paths below macOS's socket-path limit.
  const directory = await mkdtemp(join(tmpdir(), "pp-"));
  directories.push(directory);
  const endpoint = await openEventSocket(directory, deliver, async () => {});
  sockets.push(endpoint);
  return endpoint;
}

function callback(socketPath: string, body: string): Promise<number | null> {
  const child = spawn("node", [
    fileURLToPath(new URL("../accept.mjs", import.meta.url)), socketPath,
  ], { stdio: ["pipe", "ignore", "ignore"] });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  child.stdin.end(body);
  return exited;
}

afterEach(async () => {
  for (const endpoint of sockets.splice(0)) await endpoint.close();
  await Promise.all(directories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ));
});

describe("Primitive exec callback transport", () => {
  test("acknowledges only after the real callback has been accepted", async () => {
    // Given
    const received = Promise.withResolvers<string>();
    const release = Promise.withResolvers<void>();
    const endpoint = await socket(async (id) => {
      received.resolve(id);
      await release.promise;
    });
    let completed = false;
    const exit = callback(endpoint.socketPath, EVENT).then((code) => {
      completed = true;
      return code;
    });
    // When
    const id = await received.promise;
    // Then
    expect(id).toBe(EMAIL_ID);
    expect(completed).toBe(false);
    release.resolve();
    expect(await exit).toBe(0);
    expect((await stat(endpoint.socketPath)).mode & 0o777).toBe(0o600);
  });

  test("returns failure so Primitive retains an unaccepted delivery", async () => {
    // Given
    const endpoint = await socket(async () => {
      throw new ReceiverError("permission_unavailable");
    });
    // When
    const code = await callback(endpoint.socketPath, EVENT);
    // Then
    expect(code).toBe(1);
  });

  test("rejects malformed events before calling the receiver", async () => {
    // Given
    const received: string[] = [];
    const endpoint = await socket(async (id) => { received.push(id); });
    // When
    const code = await callback(endpoint.socketPath, '{"event":"email.received","email":{"id":"bad"}}');
    // Then
    expect(code).toBe(1);
    expect(received).toEqual([]);
  });

  test("closes its endpoint on shutdown", async () => {
    // Given
    const endpoint = await socket(async () => {});
    await endpoint.close();
    // When
    const code = await callback(endpoint.socketPath, EVENT);
    // Then
    expect(code).toBe(1);
  });
});
