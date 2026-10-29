import {
  DefaultResourceLoader, ExtensionRunner, ModelRegistry, ModelRuntime,
  SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { primitiveReceiver } from "../entry.ts";
import { Profile, ReceiverError } from "../schema.ts";
import { readIdentity } from "../primitive.ts";
import { startReceiver } from "../receiver.ts";

// Opt-in live check: uses only the explicitly selected Primitive profile.
// Never reads credentials into the process output or mutates another session.
const profile = Profile.parse(process.env["PRIMITIVE_AGENT_PROFILE"]);
const waitForMail = process.argv.includes("--wait-for-mail");
const directory = await mkdtemp(join(tmpdir(), "pp-live-"));
const sessionManager = SessionManager.inMemory(directory);
const delivery = Promise.withResolvers<void>();
const Stop = z.object({ binding: z.unknown(), phase: z.string(), errorCode: z.string().nullable() });
const Connected = Stop.extend({ outcome: z.literal("connected") });
let triggered = false;

const loader = new DefaultResourceLoader({
  cwd: directory,
  agentDir: directory,
  settingsManager: SettingsManager.inMemory(),
  extensionFactories: [(pi) => primitiveReceiver(pi, {
    directory: () => directory,
    identity: readIdentity,
    start: startReceiver,
  })],
  noContextFiles: true, noSkills: true, noPromptTemplates: true, noThemes: true,
});
let runner: ExtensionRunner | undefined;
try {
  await loader.reload();
  const loaded = loader.getExtensions();
  if (loaded.errors.length > 0) throw new ReceiverError("live_extension_load_failed");
  loaded.runtime.sendMessage = (message, options) => {
    // Observe Pi's real wake boundary; do not run a provider or send a reply.
    if (message.customType === "primitive:mail" && options?.triggerTurn === true &&
        options.deliverAs === "steer") {
      triggered = true;
      delivery.resolve();
    }
  };
  const models = await ModelRuntime.create({
    credentials: {
      read: async () => undefined,
      list: async () => [],
      modify: async (_provider, update) => update(undefined),
      delete: async () => {},
    },
    modelsPath: null, modelsStorePath: join(directory, "models.json"),
    allowModelNetwork: false, refreshOnCreate: false,
  });
  runner = new ExtensionRunner(
    loaded.extensions, loaded.runtime, directory, sessionManager, new ModelRegistry(models),
  );
  const context = runner.createToolContext("live-connect", undefined);
  const connect = runner.getToolDefinition("primitive_connect");
  const status = runner.getToolDefinition("primitive_status");
  if (connect === undefined || status === undefined) throw new ReceiverError("live_tools_missing");
  const connected = await connect.execute("live-connect", {
    profile, contactRequests: false,
  }, undefined, undefined, context);
  const result = Connected.parse(connected.details);
  if (result.phase !== "listener_running") throw new ReceiverError("live_listener_not_running");
  console.log(JSON.stringify({
    upstreamPi: "1.4.0", agentToolConnect: "passed", listener: result.phase,
    waitingForFreshMail: waitForMail, providerTurnTested: false,
  }));
  if (waitForMail) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new ReceiverError("live_mail_timeout")), 10 * 60_000);
      void delivery.promise.then(() => { clearTimeout(timeout); resolve(); });
    });
    const current = Stop.parse((await status.execute(
      "live-status", {}, undefined, undefined, runner.createToolContext("live-status", undefined),
    )).details);
    console.log(JSON.stringify({
      realPrimitiveEvent: triggered, upstreamPiWakeBoundary: "passed",
      listener: current.phase, providerTurnTested: false,
    }));
  }
} finally {
  await runner?.emit({ type: "session_shutdown", reason: "quit" });
  await rm(directory, { recursive: true, force: true });
}
