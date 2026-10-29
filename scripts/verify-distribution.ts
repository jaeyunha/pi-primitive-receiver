import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { ReceiverError } from "../schema.ts";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "pp-distribution-"));
const Archive = z.array(z.object({
  filename: z.string().regex(/^[a-z0-9.-]+\.tgz$/),
  files: z.array(z.object({ path: z.string() })),
})).length(1);

try {
  const packed = await execute("npm", ["pack", "--json", "--pack-destination", directory], {
    cwd: root,
    timeout: 30_000,
  });
  const [archive] = Archive.parse(JSON.parse(packed.stdout));
  if (archive === undefined) throw new ReceiverError("archive_missing");
  if (archive.files.some(({ path }) =>
    /(^|\/)(bindings|node_modules|test|\.git)(\/|$)/.test(path) ||
    path.endsWith(".tgz"))) throw new ReceiverError("private_state_in_archive");

  await execute("npm", [
    "install", "--prefix", directory, "--omit=dev", "--legacy-peer-deps",
    join(directory, archive.filename),
  ], {
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const installed = join(directory, "node_modules", "pi-primitive-receiver");
  z.object({
    private: z.literal(false).optional(),
    license: z.literal("MIT"),
    peerDependencies: z.object({
      "@earendil-works/pi-coding-agent": z.literal("*"),
      typebox: z.literal("*"),
    }),
    pi: z.object({ extensions: z.array(z.literal("./index.ts")).length(1) }),
  }).parse(JSON.parse(await readFile(join(installed, "package.json"), "utf8")));

  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: join(directory, "pi-agent"),
    settingsManager: SettingsManager.inMemory(),
    additionalExtensionPaths: [installed],
    noContextFiles: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await loader.reload();
  const result = loader.getExtensions();
  if (result.errors.length > 0) throw new ReceiverError("installed_package_load_failed");
  const extension = result.extensions.find(
    (candidate) => candidate.resolvedPath === join(installed, "index.ts"),
  );
  if (!extension?.commands.has("primitive-connect") ||
      !extension.commands.has("primitive-status")) throw new ReceiverError("installed_commands_missing");
  if (!extension.tools.has("primitive_connect") ||
      !extension.tools.has("primitive_status")) throw new ReceiverError("installed_tools_missing");
  await readFile(join(installed, "skills", "primitive-receiver", "SKILL.md"), "utf8");
  await readFile(join(installed, "LICENSE"), "utf8");
  console.log(JSON.stringify({
    productionInstall: "passed",
    upstreamPiLoader: "passed",
    privateStateExcluded: true,
    publicPublication: false,
  }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
