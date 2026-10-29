import {
  DefaultResourceLoader, ExtensionRunner, ModelRegistry, ModelRuntime,
  SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { primitiveReceiver } from "../entry.ts";
import { Address, ReceiverError } from "../schema.ts";
import type { Binding } from "../schema.ts";
import type { ReceiverHost } from "../receiver.ts";

export async function receiverFixture() {
  const directory = await mkdtemp(join(tmpdir(), "pp-tools-"));
  const sessionManager = SessionManager.inMemory(directory);
  const starts: Binding[] = [];
  const notices: unknown[] = [];
  const state: {
    failure: ReceiverError | undefined;
    phase: string;
    stops: number;
    identities: number;
    host: ReceiverHost | undefined;
  } = { failure: undefined, phase: "listener_running", stops: 0, identities: 0, host: undefined };
  // Only external identity and listener-process boundaries are substituted.
  // Bindings, session identity, loader, tool registration and execution are real.
  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager: SettingsManager.inMemory(),
    extensionFactories: [(pi) => primitiveReceiver(pi, {
      directory: () => directory,
      identity: async (_profile, signal) => {
        signal.throwIfAborted();
        state.identities += 1;
        return { address: Address.parse("agent@example.com") };
      },
      start: async (binding, _directory, host) => {
        if (state.failure !== undefined) throw state.failure;
        starts.push(binding);
        state.host = host;
        host.status(state.phase);
        return {
          get phase() { return state.phase; },
          stop: async () => { state.stops += 1; },
          emitted: async () => {},
        };
      },
    })],
    noContextFiles: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  if (loaded.errors.length > 0) throw new ReceiverError("fixture_load_failed");
  loaded.runtime.sendMessage = (message, options) => { notices.push({ message, options }); };
  const models = await ModelRuntime.create({
    credentials: {
      read: async () => undefined,
      list: async () => [],
      modify: async (_provider, update) => update(undefined),
      delete: async () => {},
    },
    modelsPath: null,
    modelsStorePath: join(directory, "models-store.json"),
    allowModelNetwork: false, refreshOnCreate: false,
  });
  const runner = new ExtensionRunner(
    loaded.extensions, loaded.runtime, directory, sessionManager, new ModelRegistry(models),
  );
  return {
    directory, sessionManager, runner, state, starts, notices,
    async invoke(name: string, args: unknown, signal?: AbortSignal) {
      const tool = runner.getToolDefinition(name);
      if (tool === undefined) throw new ReceiverError("fixture_tool_missing");
      return tool.execute("test-call", args, signal, undefined, runner.createToolContext("test-call", signal));
    },
    async close() {
      await runner.emit({ type: "session_shutdown", reason: "quit" });
      await rm(directory, { recursive: true, force: true });
    },
  };
}
