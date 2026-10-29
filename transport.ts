import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { chmod } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { Event, ReceiverError } from "./schema.ts";

export async function openEventSocket(
  directory: string,
  deliver: (emailId: string) => Promise<void>,
  failed: (error: Error) => Promise<void>,
) {
  const socketPath = join(directory, `r-${randomUUID().slice(0, 8)}.sock`);
  if (Buffer.byteLength(socketPath) > 103) throw new ReceiverError("socket_path_too_long");
  let accepting = true;
  const server = createServer((request, response) => {
    // Top-level transport boundary: no event body or provider error is echoed.
    void (async () => {
      if (request.method !== "POST" || request.url !== "/event" || !accepting) {
        response.writeHead(404).end();
        return;
      }
      try {
        let body = "";
        for await (const chunk of request) {
          body += String(chunk);
          if (Buffer.byteLength(body) > 4 * 1024 * 1024) {
            throw new ReceiverError("event_too_large");
          }
        }
        const event = Event.parse(JSON.parse(body));
        await deliver(event.email.id);
        response.writeHead(204).end();
      } catch (error) {
        response.writeHead(503).end();
        if (error instanceof Error) await failed(error);
        else throw error;
      }
    })();
  });
  const listening = once(server, "listening");
  server.listen(socketPath);
  await listening;
  await chmod(socketPath, 0o600);

  return {
    socketPath,
    async close(): Promise<void> {
      if (!accepting) return;
      accepting = false;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}
