import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ReceiverError } from "./schema.ts";
import type { Binding, Notice } from "./schema.ts";
import { cliEnvironment, cliPath, createPrimitive } from "./primitive.ts";
import { NoticeQueue } from "./queue.ts";
import { openEventSocket } from "./transport.ts";

export interface ReceiverHost {
  readonly entries: readonly unknown[];
  readonly notify: (notice: Notice) => void;
  readonly status: (phase: string) => void;
}

export async function startReceiver(binding: Binding, directory: string, host: ReceiverHost) {
  const controller = new AbortController();
  const signal = controller.signal;
  const primitive = createPrimitive(binding);
  const queue = new NoticeQueue(join(directory, "pending"), binding, host.notify);
  const processing = new Map<string, Promise<void>>();
  let stopped = false;
  let phase = "starting";

  async function status(next: string): Promise<void> {
    phase = next;
    host.status(next);
    await writeFile(join(directory, "status.json"), JSON.stringify({
      sessionId: binding.sessionId,
      address: binding.address,
      phase: next,
      updatedAt: new Date().toISOString(),
    }), { mode: 0o600 });
  }

  async function deliver(emailId: string): Promise<void> {
    if (queue.contains(emailId)) return;
    const prior = processing.get(emailId);
    if (prior !== undefined) return prior;
    const current = (async () => {
      const admitted = await primitive.admit(emailId, signal);
      signal.throwIfAborted();
      if (admitted === null) return;
      await queue.enqueue(admitted.notice, admitted.current);
      await status("receiving");
    })();
    processing.set(emailId, current);
    try {
      await current;
    } finally {
      processing.delete(emailId);
    }
  }

  await mkdir(directory, { recursive: true, mode: 0o700 });
  await primitive.identity(signal);
  const pending = await queue.open(host.entries);
  // Keep the socket short even when a harness stores state under a long path.
  const socketDirectory = await mkdtemp(join(tmpdir(), "pp-mail-"));
  const endpoint = await openEventSocket(socketDirectory, deliver, async () => {
    await status(stopped ? "stopped" : "delivery_pending");
  }).catch(async (error: unknown) => {
    await rmdir(socketDirectory);
    throw error;
  });
  const socketPath = endpoint.socketPath;

  const accept = fileURLToPath(new URL("./accept.mjs", import.meta.url));
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const child = spawn("node", [
    cliPath, "listen", "--transport", "websocket",
    "--subscription", `pi-${binding.sessionId}`,
    "--events", "email.received",
    "--exec", `node ${quote(accept)} ${quote(socketPath)}`,
  ], {
    env: cliEnvironment(binding.profile),
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.resume();
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      void status(stopped ? "stopped" : "listener_exited").finally(resolve);
    });
    child.once("error", () => {
      void status("listener_failed").finally(resolve);
    });
  });
  await status("listener_running");
  // Re-evaluate pending mail against current policy; never reuse an old permission.
  for (const notice of pending) {
    try {
      await deliver(notice.emailId);
    } catch (error) {
      if (error instanceof Error) await status("delivery_pending");
      else throw error;
    }
  }

  return {
    get phase() { return phase; },
    socketPath,
    emitted: (emailId: string) => queue.emitted(emailId),
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      controller.abort(new ReceiverError("session_shutdown"));
      const closed = endpoint.close();
      child.kill("SIGTERM");
      await Promise.all([exited, closed]);
      await rmdir(socketDirectory);
    },
  };
}
