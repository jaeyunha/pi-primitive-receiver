# Private Primitive receiving for Pi

Installable private Pi package. Nothing is published publicly. The package has
`private: true`, which prevents accidental npm publication. No mailbox identity,
session binding or credential is included in its distributable.

## Install from a local or privately shared checkout

Requires Node.js 22+ and a Pi-compatible harness with extensions and custom
message wake support. This version uses private Unix sockets (macOS/Linux).

```sh
cd /path/to/pi-primitive-receiver
bun install
pi install /absolute/path/to/pi-primitive-receiver
```

Replace `pi` with the harness's executable (`omo` or `senpi`, for example).
Reload the existing session after installation. Do not start another conversation
to attach the current one.

Developers with access to the private repository can install directly:

```sh
pi install git:github.com/jaeyunha/pi-primitive-receiver
```

Git authentication and private repository access are required. This does not
publish anything to a registry or grant another developer repository access.

Run the Primitive invitation setup supplied by the owner, with the claim URL on
stdin, exactly once. Keep the credentials in Primitive's own private store.
For a Pi runtime not yet detected by Primitive, omit Claude/Codex session flags.
Then use the profile name returned by that command:

```text
/primitive-connect <profile-name> --contact-requests
/primitive-status
```

Omit `--contact-requests` unless the owner approved first-contact intake.
An existing session binding to a different profile is never replaced implicitly.

Bindings live outside this package, under the harness's agent directory:
`primitive-receiver/bindings/<session-id>.json`. They contain session IDs and
profile names, never credentials. Each session must be bound explicitly; other
sessions cannot inherit this address. Standard Pi defaults to `~/.pi/agent`;
`PI_CODING_AGENT_DIR`, `OMO_CODING_AGENT_DIR` and `SENPI_CODING_AGENT_DIR` select
the corresponding harness directory.

To share a private archive, run `npm pack` in this directory. Recipients can
extract it into a private directory, run `bun install --production`, and install
that directory with their harness. No registry or public repository is needed.

## Receiving behavior

The extension starts `primitive listen` with a durable, profile-scoped
subscription and a short `--exec` callback. The callback forwards events through
a private Unix socket. Only server-fetched metadata can become a Pi custom
message; subjects, bodies, credentials and attachments never enter wake text.
The agent reads a notified message with the Primitive CLI before acting.

The listener is owned by the session lifecycle. Shutdown stops it. Resuming the
same session reuses the subscription and rechecks pending notices. Accepted
notices stay on disk until their custom message has entered the transcript.
Duplicate email IDs do not create another wake. Unknown-sender request candidates
are bounded to one per sender and grant no task authority.

Primitive 1.73.0 is pinned because this prototype reuses its bundled contact
policy evaluator, including explicit silences, activation cutoffs, current
membership, authenticated network admission and the final permission recheck.
It does not pretend to be Claude Code or Codex. The private policy export is the
one upstream integration boundary that should become a supported adapter API.
The remaining host side uses Pi lifecycle events and custom-message delivery.

The receiver is for an open session. It does not launch a closed application.
`listener_running` means the process started; `receiving` means a real eligible
event was handled. Neither state by itself proves that the agent answered.

Run `bun run check`, `bun run lint` and `bun test` in this directory.
`bun run verify:package` separately packs a private archive, installs only its
production dependencies into temporary state, and loads that installed package
through upstream Pi's real resource loader. It requires npm registry access.
