import { describe, expect, test } from "bun:test";
import { N as createContactPolicy } from "primitive/dist/machine-session-B6V5-grn.js";
import type { PolicyOptions } from "primitive/dist/machine-session-B6V5-grn.js";

const ADDRESS = "test-agent@example.com";
const SENDER = "owner@example.com";
const EMAIL_ID = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";
const SINCE = "2026-10-29T01:00:00.000Z";
const RECEIVED = "2026-10-29T02:00:00.000Z";
const signal = new AbortController().signal;

function composite() {
  const document = {
    rules: [],
    allow_contact_requests: false,
    contact_request_since: null,
    contact_request_generation: null,
    version: null,
    updated_at: null,
  };
  return {
    agent_address: ADDRESS,
    org_policy: document,
    agent_policy: { ...document, allow_contact_requests: null },
    effective_version: "a".repeat(64),
    effective_since: SINCE,
    allow_contact_requests: false,
    contact_request_since: null,
    contact_request_generation: null,
  };
}

function options(): PolicyOptions {
  return {
    recipient: ADDRESS,
    contactRequests: true,
    readPolicy: async () => composite(),
    readPage: async () => ({ data: [], cursor: null }),
    readNetworkAdmission: async () => ({
      allowed: true,
      pending: false,
      allowed_since: SINCE,
      member_policy_required: true,
      sender_relation: "owner",
    }),
  };
}

describe("Primitive's real contact-policy evaluator", () => {
  test("admits authenticated owner mail after the activation boundary", async () => {
    // Given
    const policy = createContactPolicy(options());
    // When
    const admission = await policy.admit(SENDER, RECEIVED, signal, EMAIL_ID);
    // Then
    expect(admission?.kind).toBe("allowed");
    expect(admission?.senderRelation).toBe("owner");
    expect(admission?.emailId).toBe(EMAIL_ID);
  });

  test("refuses explicit silence even for an authenticated owner", async () => {
    // Given
    const policy = createContactPolicy({
      ...options(),
      readPage: async () => ({
        data: [{
          agent_address: ADDRESS,
          contact_address: SENDER,
          notify: false,
          version: VERSION,
          notify_since: null,
          notification_generation: null,
        }],
        cursor: null,
      }),
    });
    // When
    const admission = await policy.admit(SENDER, RECEIVED, signal, EMAIL_ID);
    // Then
    expect(admission).toBeNull();
  });

  test("refuses mail older than network activation", async () => {
    // Given
    const policy = createContactPolicy(options());
    // When
    const admission = await policy.admit(
      SENDER, "2026-10-29T00:00:00.000Z", signal, EMAIL_ID,
    );
    // Then
    expect(admission).toBeNull();
  });

  test("refuses pending authentication rather than treating it as permission", async () => {
    // Given
    const policy = createContactPolicy({
      ...options(),
      readNetworkAdmission: async () => ({
        allowed: false,
        pending: true,
        allowed_since: null,
        member_policy_required: true,
      }),
    });
    // When
    const admission = policy.admit(SENDER, RECEIVED, signal, EMAIL_ID);
    // Then
    expect(await admission.then(() => undefined, (error: unknown) => error)).toBeInstanceOf(Error);
  });

  test("refuses dispatch when permission changes after admission", async () => {
    // Given
    let permitted = true;
    const policy = createContactPolicy({
      ...options(),
      readNetworkAdmission: async () => ({
        allowed: permitted,
        pending: false,
        allowed_since: permitted ? SINCE : null,
        member_policy_required: true,
        ...(permitted ? { sender_relation: "owner" as const } : {}),
      }),
    });
    const admission = await policy.admit(SENDER, RECEIVED, signal, EMAIL_ID);
    if (admission === null) throw new Error("Fixture did not admit owner mail");
    // When
    permitted = false;
    // Then
    expect(await policy.recheck(admission, signal).then(
      () => undefined, (error: unknown) => error,
    )).toBeInstanceOf(Error);
  });

  test("refuses ordinary unknown mail without a contact grant", async () => {
    // Given
    const policy = createContactPolicy({
      ...options(),
      readNetworkAdmission: async () => ({
        allowed: false,
        pending: false,
        allowed_since: null,
        member_policy_required: false,
      }),
    });
    // When
    const admission = await policy.admit("unknown@example.org", RECEIVED, signal, EMAIL_ID);
    // Then
    expect(admission).toBeNull();
  });
});
