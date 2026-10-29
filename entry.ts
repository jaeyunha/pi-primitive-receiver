import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { z } from "zod";
import { EmailId, Profile } from "./schema.ts";
import type { PiHost } from "./pi.ts";
import { noticeText } from "./pi.ts";
import { MESSAGE_TYPE } from "./queue.ts";
import { SessionReceiver } from "./session.ts";
import type { ReceiverOperations, ReceiverStatus } from "./session.ts";
import { connectSkillPath } from "./primitive.ts";

const Message = z.object({
  role: z.literal("custom"),
  customType: z.literal(MESSAGE_TYPE),
  details: z.object({ emailId: EmailId }),
});

function statusText(status: ReceiverStatus): string {
  return JSON.stringify(status);
}

export function primitiveReceiver(pi: PiHost, operations?: ReceiverOperations): void {
  const receiver = new SessionReceiver((notice, profile) => {
    pi.sendMessage({
      customType: MESSAGE_TYPE,
      content: noticeText(notice, profile),
      display: true,
      details: { emailId: notice.emailId, source: "primitive" },
    }, { triggerTurn: true, deliverAs: "steer" });
  }, operations);
  pi.on("session_start", async (_event, context) => {
    const status = await receiver.start(context);
    if (status.errorCode !== null) context.ui.notify(statusText(status), "error");
  });

  pi.on("resources_discover", () => ({
    skillPaths: [connectSkillPath, fileURLToPath(new URL("./skills/primitive-receiver", import.meta.url))],
  }));

  pi.on("message_end", async (event) => {
    const recorded = Message.safeParse(event.message);
    if (recorded.success) await receiver.emitted(recorded.data.details.emailId);
  });

  pi.on("session_shutdown", async (_event, context) => {
    await receiver.stop(context);
  });

  pi.registerCommand("primitive-status", {
    description: "Show this session's Primitive receiver state",
    handler: async (_args, context) => {
      context.ui.notify(statusText(await receiver.status(context)), "info");
    },
  });

  pi.registerCommand("primitive-connect", {
    description: "Bind this session to an existing Primitive profile: <profile> [--contact-requests]",
    handler: async (args, context) => {
      const [profileArgument, requestFlag, extra] = args.trim().split(/\s+/);
      if (extra !== undefined || requestFlag !== undefined && requestFlag !== "--contact-requests") {
        context.ui.notify("Use /primitive-connect <profile> [--contact-requests].", "error");
        return;
      }
      const parsed = Profile.safeParse(profileArgument);
      if (!parsed.success) {
        context.ui.notify("Use the profile printed by Primitive's connection command.", "error");
        return;
      }
      const result = await receiver.connect({
        profile: parsed.data,
        contactRequests: requestFlag === "--contact-requests",
      }, context);
      context.ui.notify(JSON.stringify(result), result.outcome === "connected" ? "info" : "warning");
    },
  });

  pi.registerTool({
    name: "primitive_connect",
    label: "Connect Primitive receiver",
    description: "Bind an existing approved Primitive profile to this exact session and start receiving now. " +
      "Does not enroll, claim invitations, replace a different binding, or prove idle wake. " +
      "Enable contactRequests only with owner approval. Use primitive_status before enrolling a new address.",
    parameters: Type.Object({
      profile: Type.String({ pattern: "^[a-zA-Z0-9_-]+$" }),
      contactRequests: Type.Boolean({ description: "Whether the owner approved first-contact intake." }),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    async execute(_id, params, signal, _update, context) {
      const result = await receiver.connect({
        profile: Profile.parse(params.profile), contactRequests: params.contactRequests,
      }, context, signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
        isError: result.outcome !== "connected",
      };
    },
  });

  pi.registerTool({
    name: "primitive_status",
    label: "Primitive receiver status",
    description: "Read this session's saved Primitive binding and live receiver phase without changing either. " +
      "listener_running means started; receiving means an eligible event was handled, not that a reply was delivered.",
    parameters: Type.Object({}, { additionalProperties: false }),
    executionMode: "sequential",
    async execute(_id, _params, _signal, _update, context) {
      const status = await receiver.status(context);
      return { content: [{ type: "text", text: statusText(status) }], details: status };
    },
  });
}
