import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { EmailId, PersistedNotice, ReceiverError } from "./schema.ts";
import type { Binding, Notice } from "./schema.ts";

export const MESSAGE_TYPE = "primitive:mail";
const RecordedMessage = z.object({
  type: z.literal("message"),
  message: z.object({
    role: z.literal("custom"),
    customType: z.literal(MESSAGE_TYPE),
    details: z.object({ emailId: EmailId }),
  }),
});

export class NoticeQueue {
  readonly #queued = new Set<string>();
  readonly #emitted = new Set<string>();
  readonly #requests = new Map<string, string>();

  constructor(
    readonly directory: string,
    readonly binding: Binding,
    readonly notify: (notice: Notice) => void,
  ) {}

  async open(entries: readonly unknown[]): Promise<readonly Notice[]> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const entry of entries) {
      const recorded = RecordedMessage.safeParse(entry);
      if (recorded.success) this.#emitted.add(recorded.data.message.details.emailId);
    }
    const pending: Notice[] = [];
    for (const name of await readdir(this.directory)) {
      if (!name.endsWith(".json")) continue;
      const saved = PersistedNotice.parse(JSON.parse(await readFile(join(this.directory, name), "utf8")));
      if (saved.sessionId !== this.binding.sessionId ||
          name !== `${saved.notice.emailId}.json`) throw new ReceiverError("queue_identity_mismatch");
      if (saved.notice.contactRequest) this.#requests.set(saved.notice.sender, saved.notice.emailId);
      if (!this.#emitted.has(saved.notice.emailId)) pending.push(saved.notice);
    }
    return pending;
  }

  contains(emailId: string): boolean {
    return this.#queued.has(emailId) || this.#emitted.has(emailId);
  }

  async enqueue(notice: Notice, current: () => void): Promise<void> {
    if (this.contains(notice.emailId)) return;
    const previousRequest = this.#requests.get(notice.sender);
    if (notice.contactRequest && previousRequest !== undefined &&
        previousRequest !== notice.emailId) return;
    const path = join(this.directory, `${notice.emailId}.json`);
    await writeFile(`${path}.tmp`, JSON.stringify({ sessionId: this.binding.sessionId, notice }), {
      mode: 0o600,
      flush: true,
    });
    await rename(`${path}.tmp`, path);
    this.#queued.add(notice.emailId);
    try {
      current();
      this.notify(notice);
    } catch (error) {
      this.#queued.delete(notice.emailId);
      throw error;
    }
    if (notice.contactRequest) this.#requests.set(notice.sender, notice.emailId);
  }

  async emitted(emailId: string): Promise<void> {
    this.#emitted.add(emailId);
    this.#queued.delete(emailId);
    try {
      const path = join(this.directory, `${EmailId.parse(emailId)}.json`);
      const saved = PersistedNotice.parse(JSON.parse(await readFile(path, "utf8")));
      // Keep a request receipt to bound unknown-sender intake across resumes.
      if (!saved.notice.contactRequest) await unlink(path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
  }
}
