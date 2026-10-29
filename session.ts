import { join } from "node:path";
import { agentDirectory, loadBinding, saveBinding } from "./configuration.ts";
import { readIdentity } from "./primitive.ts";
import { startReceiver } from "./receiver.ts";
import type { ReceiverHost } from "./receiver.ts";
import { Binding, ReceiverError } from "./schema.ts";
import type { Notice } from "./schema.ts";
import type { PiContext } from "./pi.ts";

type Listener = Pick<Awaited<ReturnType<typeof startReceiver>>, "phase" | "stop" | "emitted">;

export interface ReceiverOperations {
  readonly directory: () => string;
  readonly identity: typeof readIdentity;
  readonly start: (binding: Binding, directory: string, host: ReceiverHost) => Promise<Listener>;
}

export interface ReceiverStatus {
  readonly binding: Binding | null;
  readonly phase: string;
  readonly errorCode: string | null;
}

export interface ConnectResult extends ReceiverStatus {
  readonly outcome: "connected" | "already_bound" | "failed";
}

/** One controller per loaded extension; commands and tools share its lifecycle. */
export class SessionReceiver {
  private active: Listener | undefined;
  private binding: Binding | undefined;
  private errorCode: string | null = null;
  private transition = Promise.resolve();

  constructor(
    private readonly notify: (notice: Notice, profile: Binding["profile"]) => void,
    private readonly operations: ReceiverOperations = {
      directory: agentDirectory,
      identity: readIdentity,
      start: startReceiver,
    },
  ) {}

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.transition.then(action);
    // The caller receives the rejection; the lifecycle barrier must remain usable.
    this.transition = next.then(() => undefined, () => undefined);
    return next;
  }

  private snapshot(): ReceiverStatus {
    return {
      binding: this.binding ?? null,
      phase: this.active?.phase ?? (this.binding === undefined ? "unbound" : "inactive"),
      errorCode: this.errorCode,
    };
  }

  private async stopActive(): Promise<void> {
    await this.active?.stop();
    this.active = undefined;
  }

  private async startBound(context: PiContext): Promise<void> {
    const selected = this.binding;
    if (selected === undefined) return;
    this.errorCode = null;
    try {
      this.active = await this.operations.start(
        selected,
        join(this.operations.directory(), "primitive-receiver", selected.sessionId),
        {
          entries: context.sessionManager.getEntries(),
          status: (phase) => context.ui.setStatus("primitive", `Primitive: ${phase}`),
          notify: (notice) => this.notify(notice, selected.profile),
        },
      );
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      this.errorCode = error instanceof ReceiverError ? error.code : "startup_failed";
      context.ui.setStatus("primitive", `Primitive: ${this.errorCode}`);
    }
  }

  async start(context: PiContext): Promise<ReceiverStatus> {
    return this.exclusive(async () => {
      await this.stopActive();
      this.errorCode = null;
      this.binding = await loadBinding(this.operations.directory(), context.sessionManager.getSessionId());
      await this.startBound(context);
      return this.snapshot();
    });
  }

  async status(context: PiContext): Promise<ReceiverStatus> {
    return this.exclusive(async () => {
      this.binding = await loadBinding(this.operations.directory(), context.sessionManager.getSessionId());
      return this.snapshot();
    });
  }

  async connect(
    request: { readonly profile: Binding["profile"]; readonly contactRequests: boolean },
    context: PiContext,
    signal?: AbortSignal,
  ): Promise<ConnectResult> {
    return this.exclusive(async () => {
      signal?.throwIfAborted();
      const directory = this.operations.directory();
      const sessionId = context.sessionManager.getSessionId();
      this.binding = await loadBinding(directory, sessionId);
      if (this.binding !== undefined && this.binding.profile !== request.profile) {
        return { ...this.snapshot(), outcome: "already_bound" };
      }
      const timeout = AbortSignal.timeout(15_000);
      const identity = await this.operations.identity(
        request.profile, signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      );
      signal?.throwIfAborted();
      if (this.binding !== undefined && this.binding.address !== identity.address) {
        throw new ReceiverError("identity_mismatch");
      }
      const selected = Binding.parse({ sessionId, ...request, address: identity.address });
      if (this.binding?.address === selected.address &&
          this.binding.contactRequests === selected.contactRequests &&
          this.active !== undefined && ["listener_running", "receiving"].includes(this.active.phase)) {
        return { ...this.snapshot(), outcome: "connected" };
      }
      await saveBinding(directory, selected);
      this.binding = selected;
      await this.stopActive();
      await this.startBound(context);
      return { ...this.snapshot(), outcome: this.errorCode === null ? "connected" : "failed" };
    });
  }

  async stop(context: PiContext): Promise<void> {
    return this.exclusive(async () => {
      await this.stopActive();
      this.binding = undefined;
      this.errorCode = null;
      context.ui.setStatus("primitive", undefined);
    });
  }

  async emitted(emailId: string): Promise<void> {
    await this.active?.emitted(emailId);
  }
}
