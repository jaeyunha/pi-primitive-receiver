// This prototype deliberately pins Primitive 1.73.0's own policy implementation.
// Upstream should expose this factory as a supported receiver-adapter API.
declare module "primitive/dist/machine-session-B6V5-grn.js" {
  export interface Admission {
    readonly sender: string;
    readonly receivedAt: string;
    readonly emailId?: string;
    readonly kind: "allowed" | "request" | "response";
    readonly generation: string;
    readonly notifySince: string;
    readonly effectiveVersion: string;
    readonly source?: string;
    readonly senderRelation?: "owner" | "member";
  }
  export interface NetworkAdmission {
    readonly allowed: boolean;
    readonly pending: boolean;
    readonly allowed_since: string | null;
    readonly member_policy_required: boolean;
    readonly sender_relation?: "owner" | "member" | undefined;
  }
  export interface PolicyOptions {
    readonly recipient: string;
    readonly contactRequests: boolean;
    readonly readPolicy: (signal: AbortSignal) => Promise<unknown>;
    readonly readPage: (
      cursor: string | undefined,
      signal: AbortSignal,
    ) => Promise<{ readonly data: readonly unknown[]; readonly cursor: string | null }>;
    readonly readNetworkAdmission: (
      emailId: string,
      sender: string,
      signal: AbortSignal,
    ) => Promise<NetworkAdmission>;
    readonly now?: () => number;
  }
  export function N(options: PolicyOptions): {
    admit(
      sender: string,
      receivedAt: string,
      signal: AbortSignal,
      emailId: string,
    ): Promise<Admission | null>;
    recheck(prior: Admission, signal: AbortSignal): Promise<() => void>;
  };
}
