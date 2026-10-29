import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { N as createContactPolicy } from "primitive/dist/machine-session-B6V5-grn.js";
import { z } from "zod";
import { Address, Mail, NetworkDecision, Notice, ReceiverError } from "./schema.ts";
import type { Binding } from "./schema.ts";

const execute = promisify(execFile);
export const cliPath = createRequire(import.meta.url).resolve("primitive/bin/run.js");
export const connectSkillPath = join(dirname(dirname(cliPath)), "dist", "skills", "primitive-connect");
const ContactPage = z.object({
  success: z.literal(true),
  data: z.array(z.unknown()),
  meta: z.object({ cursor: z.string().nullable() }),
});

export function cliEnvironment(profile: Binding["profile"]): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, PRIMITIVE_AGENT_PROFILE: profile };
  // Never let a caller's unrelated API-key override the selected private profile.
  delete environment["PRIMITIVE_API_KEY"];
  return environment;
}

async function cliJson(
  profile: Binding["profile"],
  args: readonly string[],
  signal: AbortSignal,
): Promise<unknown> {
    try {
      const { stdout } = await execute("node", [cliPath, ...args, "--json"], {
        env: cliEnvironment(profile),
        signal,
        timeout: 15_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return JSON.parse(stdout);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof Error) throw new ReceiverError(`cli_${args[0]}_failed`);
      throw error;
    }
}

export async function readIdentity(profile: Binding["profile"], signal: AbortSignal) {
  return z.object({ address: Address }).parse(await cliJson(profile, ["whoami"], signal));
}

export function createPrimitive(binding: Binding) {
  const json = (args: readonly string[], signal: AbortSignal) => cliJson(binding.profile, args, signal);

  const policy = createContactPolicy({
    recipient: binding.address,
    contactRequests: binding.contactRequests,
    readPolicy: (signal) => json([
      "contacts", "get-agent-contact-policy", "--agent-address", binding.address,
    ], signal),
    async readPage(cursor, signal) {
      const page = ContactPage.parse(await json([
        "agent", "contacts", "list", "--limit", "100",
        ...(cursor === undefined ? [] : ["--cursor", cursor]),
      ], signal));
      return { data: page.data, cursor: page.meta.cursor };
    },
    async readNetworkAdmission(emailId, sender, signal) {
      return NetworkDecision.parse(await json([
        "agent-networks", "check-default-network-contact-admission",
        "--email-id", emailId, "--sender-address", sender,
      ], signal));
    },
  });

  return {
    async identity(signal: AbortSignal): Promise<void> {
      const identity = await readIdentity(binding.profile, signal);
      if (identity.address !== binding.address) throw new ReceiverError("identity_mismatch");
    },
    async admit(emailId: string, signal: AbortSignal) {
      const mail = Mail.parse(await json(["emails", "get", "--id", emailId], signal));
      if (mail.id !== emailId || mail.recipient !== binding.address ||
          mail.to_email !== binding.address) throw new ReceiverError("recipient_mismatch");
      if (!["accepted", "completed"].includes(mail.status) || mail.parsed.status !== "complete") {
        throw new ReceiverError("mail_processing");
      }
      if (mail.fyi || mail.muted || mail.automated || mail.presence_control !== null ||
          mail.interaction_hint === "status" || mail.from_email === binding.address) return null;
      if (!mail.from_verified || mail.from_header_email?.toLowerCase() !== mail.from_email) {
        return null;
      }
      const admission = await policy.admit(
        mail.from_email, mail.received_at, signal, mail.id,
      );
      if (admission === null) return null;
      // Unapproved senders can surface only as a bounded request candidate,
      // never as ordinary task mail. The agent validates it with --context.
      const request = admission.kind === "request";
      if (request && !mail.interaction_candidate) return null;
      const current = await policy.recheck(admission, signal);
      return {
        notice: Notice.parse({
          emailId: mail.id,
          sender: mail.from_email,
          relationship: mail.collaboration.sender_relationship,
          threadId: mail.collaboration.thread_id,
          receivedAt: mail.received_at,
          contactRequest: request,
        }),
        current,
      };
    },
  };
}
