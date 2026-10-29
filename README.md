# Primitive receiver for Pi

Receive Primitive email in an open Pi-compatible coding-agent session and wake
the agent when eligible mail arrives. Agents can connect their own approved
profile through tools, without asking a human to execute slash commands.

**Experimental, community-maintained integration.** Not an official Primitive
or Pi package. It uses a version-specific internal policy export from Primitive
CLI 1.73.0. That dependency is pinned; upgrading it requires reviewing the export
and re-verifying policy behavior. A supported upstream policy API would remove
this maintenance constraint.

## Install

Requires Node.js 22.19+ and a Pi-compatible harness with extension tools,
lifecycle events, resource discovery and custom-message wake support.

```sh
pi install git:github.com/jaeyunha/pi-primitive-receiver
```

The source is public and MIT-licensed. This release is distributed through
GitHub, not npm, and is not listed in Pi's npm-backed package catalog.
`private: true` in the manifest prevents accidental npm publication; it does
not restrict use or redistribution under the MIT license.

Replace `pi` with your harness executable, such as `omo` or `senpi`. An already
open session needs one `/reload` after installation or an update. New sessions
load the installed extension automatically. Do not open a different conversation
to attach the one you are configuring.

Installation is shared within the harness's agent directory. Mailbox bindings
are not: each session needs its own explicit approved profile.

## Connect a session

Ask your agent:

> Set up Primitive for this exact session. Load primitive-receiver and
> primitive-connect, inspect the current binding, reuse my approved existing
> profile or enroll using my saved member login if needed, then start the
> receiver with the extension tools. Ask before replacing or adding an address.
> Keep credentials private and report the actual receiver state.

The agent uses:

```text
primitive_status({})
primitive_connect({ profile: "<approved-profile>", contactRequests: false })
```

These are agent tools, not shell commands. The connect tool verifies the profile
identity, saves a private binding to the actual current session and starts the
receiver immediately. It does not create an address or claim an invitation.
Set `contactRequests: true` only if the owner approved first-contact intake.

If no approved profile exists, Primitive supports enrollment through a saved
member login on a trusted machine, or an owner-supplied one-use invitation.
The bundled `primitive-connect` skill documents those flows. Pass invitation
URLs on stdin, never as command arguments. Do not install Claude/Codex hooks
for Pi or OmO.

If this session already has another address, stop and ask whether to keep,
replace or add; do not claim another invitation automatically. This extension
currently supports one receiver profile per session and refuses a different
saved binding. It does not implement address replacement or multi-mailbox
receiving.

The human-entered alternatives are:

```text
/primitive-connect <approved-profile>
/primitive-status
```

Add `--contact-requests` to the human connect command only with owner approval.
Neither interface requires restarting a session after a successful connection.

## Receiving states and troubleshooting

| Result | Meaning / next step |
| --- | --- |
| `binding: null`, `unbound` | No receiver binding for this session; connect an approved profile. |
| Saved binding, `inactive` | Call `primitive_connect` with that profile and its approved contact-request setting. |
| `listener_running` | The listener process started. This alone does not prove a mail event arrived. |
| `receiving` | An eligible real mail event was handled. This alone does not prove the agent answered. |
| `already_bound` | Another profile is bound; nothing was replaced. Ask the owner. |
| `errorCode`, `listener_failed`, `listener_exited`, `delivery_pending` | Report the exact state instead of claiming healthy receiving. |

- If tools are deferred, discover `primitive_connect` and `primitive_status`
  through the harness's tool search.
- If they are absent, reload the running session once and confirm the package is
  installed and enabled. Do not create another address to fix missing tools.
- Primitive CLI may report `poll` when it does not own a native receiver for your
  harness. Check `primitive_status`: this extension runs a separate listener.
- Resuming the same bound session restarts its receiver. Closing the session
  stops it; this extension does not launch a closed application.
- To prove idle wake, send a fresh Primitive message while the session is idle
  and verify its read and reply. A manual mail check is not that proof.

Update with the package-update command supported by your harness. For current
upstream Pi:

```sh
pi update --extensions
```

Then `/reload` any session that is still running the old extension.

## Compatibility and evidence

| Environment | Evidence |
| --- | --- |
| Upstream Pi 1.4.0 on macOS | Real resource-loader and tool-runner tests, clean production archive installation, and authenticated tool-driven listener startup with a fresh Primitive event reaching Pi's custom-message wake interface. No model-provider turn was run in that isolated live check. |
| OmO 5.1.51 on macOS | Real idle-mail wake, authenticated read and delivered reply on the initial receiver; agent-callable setup is separately integration-tested. |
| Linux | Unix-socket implementation is intended to work; live receiving has not been verified. |
| Windows | Unsupported by the current private Unix-socket transport. |
| Other Pi forks or versions | Not certified; verify the required extension APIs and real idle wake. |

Do not interpret a permissive host peer dependency as certification of every Pi
version. Fresh-machine setup, account authentication and provider behavior depend
on Primitive and the host environment.

## Privacy and behavior

- Credentials remain in Primitive's credential store. No account, invitation,
  mailbox identity or session binding is shipped in this package.
- Bindings live under the harness agent directory at
  `primitive-receiver/bindings/<session-id>.json`, with private file permissions.
  They contain the session ID, profile, address and contact-request setting,
  not credentials.
- `PI_CODING_AGENT_DIR`, `OMO_CODING_AGENT_DIR` or `SENPI_CODING_AGENT_DIR`
  select the agent directory; the default is `~/.pi/agent`.
- The session-owned Primitive listener delivers events through a private Unix
  socket. Wake notices contain server-fetched metadata only, never subjects,
  bodies or attachments. The agent reads mail separately through Primitive.
- Primitive's policy evaluator preserves explicit silences, activation cutoffs,
  membership and authenticated network admission. Permission is checked again
  immediately before dispatch.
- Pending notices survive until committed to the transcript. Duplicate email IDs
  do not generate repeated wakes. Unknown-sender request candidates are bounded
  and do not grant task authority.
- This extension sends no email automatically; the agent handles authenticated
  requests under its owner's instructions.

## Development

```sh
git clone https://github.com/jaeyunha/pi-primitive-receiver.git
cd pi-primitive-receiver
bun install
bun run check
bun run lint
bun test
bun run verify:package
```

`verify:package` packs an allowlisted archive, installs only production
dependencies without auto-installing host peers, and loads it through the real
upstream Pi loader. It checks tools, commands, skill and license presence and
rejects private-state paths. It requires npm registry access and never publishes.

For an opt-in live upstream Pi tool-runner check using your own approved profile:

```sh
PRIMITIVE_AGENT_PROFILE=<approved-profile> bun run verify:live --wait-for-mail
```

This creates isolated temporary Pi state, calls the real connect tool and starts
a real Primitive listener. After it reports `waitingForFreshMail: true`, send a
fresh eligible message to that profile's address. The check waits up to ten
minutes for delivery to Pi's custom-message wake boundary, then shuts down and
removes only its own temporary state. It never sends mail, runs a model provider,
changes existing bindings or alters contact policy. Omit `--wait-for-mail` to
check authenticated listener startup only. This is not proof of a model-generated
answer; test that separately in a real interactive session.

Report issues with the harness and version, operating system, package version,
and receiver phase/error code. Do not include credentials, invitation URLs,
private mail contents or screenshots containing secrets.

Contributions should preserve session isolation, contact-policy refusals,
deterministic tests and metadata-only wake notices.

## License

MIT. Dependency licenses remain with their respective owners.
