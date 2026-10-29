import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Binding, Event, Notice, ReceiverError } from "../schema.ts";
import { MESSAGE_TYPE, NoticeQueue } from "../queue.ts";

const binding = Binding.parse({
  sessionId: "11111111-1111-4111-8111-111111111111",
  profile: "test-profile",
  address: "agent@example.com",
  contactRequests: true,
});
const notice = Notice.parse({
  emailId: "22222222-2222-4222-8222-222222222222",
  sender: "owner@example.com",
  relationship: "owner",
  threadId: "33333333-3333-4333-8333-333333333333",
  receivedAt: "2026-10-29T02:00:00.000Z",
  contactRequest: false,
});
const directories: string[] = [];
const current = () => {};

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "pi-primitive-test-"));
  directories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(
    (path) => rm(path, { recursive: true, force: true }),
  ));
});

describe("durable session notice queue", () => {
  test("delivers duplicate email IDs only once", async () => {
    // Given
    const delivered: Notice[] = [];
    const queue = new NoticeQueue(await directory(), binding, (item) => delivered.push(item));
    await queue.open([]);
    await queue.enqueue(notice, current);
    // When
    await queue.enqueue(notice, current);
    // Then
    expect(delivered.map((item) => item.emailId)).toEqual([notice.emailId]);
  });

  test("restores a notice not yet committed to the transcript", async () => {
    // Given
    const path = await directory();
    const first = new NoticeQueue(path, binding, () => {});
    await first.open([]);
    await first.enqueue(notice, current);
    const delivered: Notice[] = [];
    const restored = new NoticeQueue(path, binding, (item) => delivered.push(item));
    // When
    const pending = await restored.open([]);
    for (const item of pending) await restored.enqueue(item, current);
    // Then
    expect(delivered).toEqual([notice]);
  });

  test("does not replay a notice already written in the transcript", async () => {
    // Given
    const path = await directory();
    const first = new NoticeQueue(path, binding, () => {});
    await first.open([]);
    await first.enqueue(notice, current);
    const restored = new NoticeQueue(path, binding, () => {
      throw new Error("A committed notice was replayed");
    });
    // When
    const pending = await restored.open([{
      type: "message",
      message: {
        role: "custom",
        customType: MESSAGE_TYPE,
        details: { emailId: notice.emailId },
      },
    }]);
    // Then
    expect(pending).toEqual([]);
    expect(restored.contains(notice.emailId)).toBe(true);
  });

  test("retains pending mail when runtime delivery throws", async () => {
    // Given
    const path = await directory();
    const first = new NoticeQueue(path, binding, () => {
      throw new ReceiverError("runtime_stopped");
    });
    await first.open([]);
    await expect(first.enqueue(notice, current)).rejects.toBeInstanceOf(ReceiverError);
    const restored = new NoticeQueue(path, binding, () => {});
    // When
    const pending = await restored.open([]);
    // Then
    expect(pending).toEqual([notice]);
  });

  test("refuses another session's persisted queue", async () => {
    // Given
    const path = await directory();
    const first = new NoticeQueue(path, binding, () => {});
    await first.open([]);
    await first.enqueue(notice, current);
    const other = new NoticeQueue(path, Binding.parse({
      ...binding,
      sessionId: "44444444-4444-4444-8444-444444444444",
    }), () => {});
    // When
    const restored = other.open([]);
    // Then
    await expect(restored).rejects.toBeInstanceOf(ReceiverError);
  });

  test("bounds request candidates across receiver restarts", async () => {
    // Given
    const path = await directory();
    const request = Notice.parse({ ...notice, contactRequest: true });
    const first = new NoticeQueue(path, binding, () => {});
    await first.open([]);
    await first.enqueue(request, current);
    await first.emitted(request.emailId);
    const delivered: Notice[] = [];
    const restored = new NoticeQueue(path, binding, (item) => delivered.push(item));
    await restored.open([]);
    // When
    await restored.enqueue(Notice.parse({
      ...request,
      emailId: "55555555-5555-4555-8555-555555555555",
    }), current);
    // Then
    expect(delivered).toEqual([]);
  });

  test("checks permission immediately before dispatch and retains refused work", async () => {
    // Given
    const path = await directory();
    const delivered: Notice[] = [];
    const queue = new NoticeQueue(path, binding, (item) => delivered.push(item));
    await queue.open([]);
    // When
    const dispatch = queue.enqueue(notice, () => {
      throw new ReceiverError("permission_changed");
    });
    // Then
    await expect(dispatch).rejects.toBeInstanceOf(ReceiverError);
    expect(delivered).toEqual([]);
    const restored = new NoticeQueue(path, binding, () => {});
    expect(await restored.open([])).toEqual([notice]);
  });
});

describe("receiver input boundaries", () => {
  test("keeps authored fields out of a parsed wake event", () => {
    // Given
    const event = {
      event: "email.received",
      email: { id: notice.emailId, subject: "UNTRUSTED_SUBJECT", body_text: "UNTRUSTED_BODY" },
    };
    // When
    const parsed = Event.parse(event);
    // Then
    expect(Object.keys(parsed.email)).toEqual(["id"]);
  });
});
