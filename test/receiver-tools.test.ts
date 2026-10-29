import { afterEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { loadBinding, saveBinding } from "../configuration.ts";
import { Binding, Notice, ReceiverError } from "../schema.ts";
import { receiverFixture } from "./receiver-fixture.ts";

const fixtures: Awaited<ReturnType<typeof receiverFixture>>[] = [];
async function fixture() {
  const value = await receiverFixture();
  fixtures.push(value);
  return value;
}
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((value) => value.close()));
});
const request = { profile: "approved-profile", contactRequests: true };

describe("agent-callable receiver lifecycle through real Pi tools", () => {
  test("discovers the bundled receiver setup skill through Pi resources", async () => {
    // Given
    const f = await fixture();
    // When
    const resources = await f.runner.emitResourcesDiscover(f.directory, "startup");
    // Then
    expect(resources.skillPaths.map((resource) => resource.path)).toContain(
      fileURLToPath(new URL("../skills/primitive-receiver", import.meta.url)),
    );
  });

  test("reports an unbound session without creating a listener", async () => {
    // Given
    const f = await fixture();
    // When
    const result = await f.invoke("primitive_status", {});
    // Then
    expect(result.details).toEqual({ binding: null, phase: "unbound", errorCode: null });
    expect(f.starts).toEqual([]);
  });

  test("binds the actual session and starts receiving without a slash command or resume", async () => {
    // Given
    const f = await fixture();
    // When
    const result = await f.invoke("primitive_connect", request);
    // Then
    const binding = await loadBinding(f.directory, f.sessionManager.getSessionId());
    const expected = Binding.parse({
      ...request, sessionId: f.sessionManager.getSessionId(), address: "agent@example.com",
    });
    expect(binding).toEqual(expected);
    expect(f.starts).toEqual([expected]);
    expect(result.details).toEqual({
      binding, phase: "listener_running", errorCode: null, outcome: "connected",
    });
    expect(result.isError).toBe(false);
  });

  test("reuses an unchanged healthy listener", async () => {
    // Given
    const f = await fixture();
    await f.invoke("primitive_connect", request);
    // When
    await f.invoke("primitive_connect", request);
    // Then
    expect(f.starts).toHaveLength(1);
    expect(f.state.stops).toBe(0);
  });

  test("refuses another profile without replacing the binding or checking its identity", async () => {
    // Given
    const f = await fixture();
    await f.invoke("primitive_connect", request);
    const previous = await loadBinding(f.directory, f.sessionManager.getSessionId());
    // When
    const result = await f.invoke("primitive_connect", { ...request, profile: "another-profile" });
    // Then
    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({ outcome: "already_bound", binding: previous });
    expect(await loadBinding(f.directory, f.sessionManager.getSessionId())).toEqual(previous);
    expect(f.state.identities).toBe(1);
    expect(f.state.stops).toBe(0);
  });

  test("retains the binding but reports a startup failure as a failed tool result", async () => {
    // Given
    const f = await fixture();
    f.state.failure = new ReceiverError("identity_mismatch");
    // When
    const result = await f.invoke("primitive_connect", request);
    // Then
    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({
      outcome: "failed", phase: "inactive", errorCode: "identity_mismatch",
    });
    expect(await loadBinding(f.directory, f.sessionManager.getSessionId())).toMatchObject(request);
  });

  test("activates an existing saved binding in the running session", async () => {
    // Given
    const f = await fixture();
    await saveBinding(f.directory, Binding.parse({
      ...request, sessionId: f.sessionManager.getSessionId(), address: "agent@example.com",
    }));
    // When
    const result = await f.invoke("primitive_connect", request);
    // Then
    expect(result.details).toMatchObject({ outcome: "connected", phase: "listener_running" });
    expect(f.starts).toHaveLength(1);
  });

  test("shares binding and listener state with the human slash command", async () => {
    // Given
    const f = await fixture();
    const command = f.runner.getCommand("primitive-connect");
    if (command === undefined) throw new ReceiverError("fixture_command_missing");
    // When
    await command.handler("approved-profile --contact-requests", f.runner.createCommandContext());
    // Then
    expect((await f.invoke("primitive_status", {})).details).toMatchObject({
      binding: { ...request, sessionId: f.sessionManager.getSessionId() }, phase: "listener_running",
    });
  });

  test("resumes a saved binding through the real Pi lifecycle", async () => {
    // Given
    const f = await fixture();
    await saveBinding(f.directory, Binding.parse({
      ...request, sessionId: f.sessionManager.getSessionId(), address: "agent@example.com",
    }));
    // When
    await f.runner.emit({ type: "session_start", reason: "resume" });
    // Then
    expect(f.starts).toHaveLength(1);
    expect((await f.invoke("primitive_status", {})).details).toMatchObject({ phase: "listener_running" });
  });

  test("stops the active listener on session shutdown", async () => {
    // Given
    const f = await fixture();
    await f.invoke("primitive_connect", request);
    // When
    await f.runner.emit({ type: "session_shutdown", reason: "quit" });
    // Then
    expect(f.state.stops).toBe(1);
    expect((await f.invoke("primitive_status", {})).details).toMatchObject({ phase: "inactive" });
  });

  test("reports a listener exit rather than cached successful startup", async () => {
    // Given
    const f = await fixture();
    await f.invoke("primitive_connect", request);
    f.state.phase = "listener_exited";
    // When
    const result = await f.invoke("primitive_status", {});
    // Then
    expect(result.details).toMatchObject({ phase: "listener_exited" });
  });

  test("does not save a binding or start a listener for a canceled connect", async () => {
    // Given
    const f = await fixture();
    const signal = AbortSignal.abort(new ReceiverError("canceled"));
    // When
    const result = f.invoke("primitive_connect", request, signal);
    // Then
    expect(await result.then(() => undefined, (error: unknown) => error)).toBeInstanceOf(ReceiverError);
    expect(await loadBinding(f.directory, f.sessionManager.getSessionId())).toBeUndefined();
    expect(f.starts).toEqual([]);
  });

  test("routes notices through the selected profile and Pi wake API", async () => {
    // Given
    const f = await fixture();
    await f.invoke("primitive_connect", request);
    const notice = Notice.parse({
      emailId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sender: "owner@example.com",
      relationship: "owner", threadId: null, receivedAt: "2026-10-29T00:00:00.000Z",
      contactRequest: false,
    });
    // When
    f.state.host?.notify(notice);
    // Then
    expect(f.notices).toMatchObject([{
      message: { customType: "primitive:mail", details: { emailId: notice.emailId } },
      options: { triggerTurn: true, deliverAs: "steer" },
    }]);
  });

  test("serializes simultaneous competing bindings without replacing the first", async () => {
    // Given
    const f = await fixture();
    // When
    const results = await Promise.all([
      f.invoke("primitive_connect", request),
      f.invoke("primitive_connect", { ...request, profile: "another-profile" }),
    ]);
    // Then
    expect(results.map((result) => result.isError)).toEqual([false, true]);
    expect(f.starts).toHaveLength(1);
    expect(await loadBinding(f.directory, f.sessionManager.getSessionId())).toMatchObject(request);
  });

  test("preserves disabled contact requests when starting receiving", async () => {
    // Given
    const f = await fixture();
    // When
    const result = await f.invoke("primitive_connect", { ...request, contactRequests: false });
    // Then
    expect(result.details).toMatchObject({ binding: { contactRequests: false } });
    expect(f.starts.map((binding) => binding.contactRequests)).toEqual([false]);
  });
});
