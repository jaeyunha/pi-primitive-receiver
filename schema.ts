import { z } from "zod";

export const SessionId = z.uuid().brand<"SessionId">();
export const EmailId = z.uuid().brand<"EmailId">();
export const Address = z.email().toLowerCase().brand<"Address">();
export const Profile = z.string().regex(/^[a-zA-Z0-9_-]+$/).brand<"Profile">();

export const Binding = z.object({
  sessionId: SessionId,
  profile: Profile,
  address: Address,
  contactRequests: z.boolean(),
}).readonly();
export type Binding = z.infer<typeof Binding>;

// Parse only metadata. Authored bodies and attachments never become wake text.
export const Mail = z.object({
  id: EmailId,
  from_email: Address,
  to_email: Address,
  recipient: Address,
  received_at: z.iso.datetime(),
  status: z.string(),
  from_verified: z.boolean(),
  from_header_email: z.string().nullable(),
  sender_connected_agent_verified: z.boolean(),
  fyi: z.boolean(),
  muted: z.boolean(),
  automated: z.boolean(),
  presence_control: z.unknown().nullable(),
  interaction_hint: z.string(),
  interaction_candidate: z.boolean(),
  parsed: z.object({ status: z.string(), attachments: z.array(z.unknown()) }),
  collaboration: z.object({
    thread_id: z.uuid().nullable(),
    in_thread: z.boolean(),
    sender_relationship: z.string().regex(/^[a-z_]+$/),
    newer_inbound_count: z.number().int().nonnegative(),
  }),
}).readonly();
export type Mail = z.infer<typeof Mail>;

export const Event = z.object({
  event: z.literal("email.received"),
  email: z.object({ id: EmailId }),
});

export const NetworkDecision = z.object({
  allowed: z.boolean(),
  pending: z.boolean(),
  allowed_since: z.iso.datetime().nullable(),
  member_policy_required: z.boolean(),
  sender_relation: z.enum(["owner", "member"]).optional(),
});

export const Notice = z.object({
  emailId: EmailId,
  sender: Address,
  relationship: z.string().regex(/^[a-z_]+$/),
  threadId: z.uuid().nullable(),
  receivedAt: z.iso.datetime(),
  contactRequest: z.boolean(),
}).readonly();
export type Notice = z.infer<typeof Notice>;

export const PersistedNotice = z.object({
  sessionId: SessionId,
  notice: Notice,
});

export class ReceiverError extends Error {
  constructor(readonly code: string) {
    super(`Primitive receiver: ${code}`);
    this.name = "ReceiverError";
  }
}
