import { request } from "node:http";

const socketPath = process.argv[2];
if (!socketPath) process.exit(1);

// The complete event stays on stdin and the private socket, never argv or logs.
const outgoing = request({
  socketPath,
  path: "/event",
  method: "POST",
  headers: { "content-type": "application/json" },
  timeout: 120_000,
}, (response) => {
  response.resume();
  response.once("end", () => {
    process.exitCode = response.statusCode === 204 ? 0 : 1;
  });
});
outgoing.once("timeout", () => outgoing.destroy());
outgoing.once("error", () => { process.exitCode = 1; });
process.stdin.pipe(outgoing);
