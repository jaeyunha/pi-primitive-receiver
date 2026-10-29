import { join } from "node:path";
import { z } from "zod";
import { Binding, EmailId, Profile, ReceiverError } from "./schema.ts";
import type { PiContext, PiHost } from "./pi.ts";
import { noticeText } from "./pi.ts";
import { MESSAGE_TYPE } from "./queue.ts";
import { startReceiver } from "./receiver.ts";
import { agentDirectory, loadBinding, saveBinding } from "./configuration.ts";
import { connectSkillPath, readIdentity } from "./primitive.ts";

const Message = z.object({
  role: z.literal("custom"),
  customType: z.literal(MESSAGE_TYPE),
  details: z.object({ emailId: EmailId }),
});

export function primitiveReceiver(pi: PiHost): void {
  let active: Awaited<ReturnType<typeof startReceiver>> | undefined;
  let binding: Binding | undefined;

  async function start(context: PiContext): Promise<void> {
    binding = await loadBinding(agentDirectory(), context.sessionManager.getSessionId());
    if (binding === undefined) return;
    const selected = binding;
    try {
      active = await startReceiver(
        selected,
        join(agentDirectory(), "primitive-receiver", selected.sessionId),
        {
          entries: context.sessionManager.getEntries(),
          status: (phase) => context.ui.setStatus("primitive", `Primitive: ${phase}`),
          notify: (notice) => pi.sendMessage({
            customType: MESSAGE_TYPE,
            content: noticeText(notice, selected.profile),
            display: true,
            details: { emailId: notice.emailId, source: "primitive" },
          }, { triggerTurn: true, deliverAs: "steer" }),
        },
      );
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const code = error instanceof ReceiverError ? error.code : "startup_failed";
      context.ui.setStatus("primitive", `Primitive: ${code}`);
      context.ui.notify(`Primitive receiver could not start (${code}).`, "error");
    }
  }

  pi.on("session_start", async (_event, context) => start(context));

  pi.on("resources_discover", () => ({
    skillPaths: [connectSkillPath],
  }));

  pi.on("message_end", async (event) => {
    const recorded = Message.safeParse(event.message);
    if (recorded.success) await active?.emitted(recorded.data.details.emailId);
  });

  pi.on("session_shutdown", async (_event, context) => {
    await active?.stop();
    active = undefined;
    binding = undefined;
    context.ui.setStatus("primitive", undefined);
  });

  pi.registerCommand("primitive-status", {
    description: "Show this session's Primitive receiver state",
    handler: async (_args, context) => {
      context.ui.notify(active === undefined
        ? "No Primitive receiver is active in this session."
        : `Primitive receiver: ${active.phase}`, "info");
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
      const directory = agentDirectory();
      const sessionId = context.sessionManager.getSessionId();
      const previous = await loadBinding(directory, sessionId);
      if (previous !== undefined && previous.profile !== parsed.data) {
        context.ui.notify("This session is already bound. Its existing address was kept.", "warning");
        return;
      }
      const identity = await readIdentity(parsed.data, AbortSignal.timeout(15_000));
      await saveBinding(directory, Binding.parse({
        sessionId,
        profile: parsed.data,
        address: identity.address,
        contactRequests: requestFlag === "--contact-requests",
      }));
      await active?.stop();
      active = undefined;
      await start(context);
      if (active !== undefined) context.ui.notify(`Primitive connected as ${identity.address}.`, "info");
    },
  });
}
