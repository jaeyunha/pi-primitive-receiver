---
name: primitive-receiver
description: Connect or inspect Primitive automatic mail receiving in this Pi, OmO or Senpi session. Use when setting up Primitive, after connect or enroll returns a profile, or when a connected session reports poll mode, inactive receiving or unavailable slash-command execution.
---

# Primitive receiving in this session

The installed extension provides agent-callable `primitive_connect` and
`primitive_status` tools. Use these directly, not shell commands, slash-command
execution, hand-written binding files or a request that the owner type commands.
If the tools are deferred, discover them through the harness's tool search.

## Connect

1. Load `primitive-connect` for Primitive identity, enrollment, credentials and
   contact policy. Call `primitive_status` before creating an address.
2. Reuse the profile already approved for this session. If there is no profile,
   follow Primitive's supported connect or enroll flow under the owner's
   authorization. Never claim a pasted invitation supplied only for discussion.
   When any existing connection is found, ask whether to keep, replace or add
   and wait before enrolling or claiming another address.
3. Call `primitive_connect` with the returned `profile` and explicit
   `contactRequests` boolean. Set it true only when the owner approved
   first-contact intake. The tool verifies the profile identity, saves a private
   binding to the actual current session and starts its receiver immediately.
   Do not supply or invent a session ID.
4. Call `primitive_status` and report the actual result. A successful Primitive
   CLI connection that reports `poll` does not describe this separate extension
   listener. Check the extension tool before telling the owner automatic wake
   is unavailable.

`primitive_connect` does not create addresses, claim invitations, install hooks
or replace a different saved binding. `already_bound` means nothing was
replaced; keep it and report the conflict. Do not bypass this refusal by editing
files or borrowing another session's profile. The extension currently supports
one receiver identity per session.

## Status and recovery

- `binding: null`, `phase: unbound`: no receiver binding for this session.
- Saved binding with `phase: inactive`: no live receiver. Use `primitive_connect`
  with that same profile and its saved contact-request setting.
- `listener_running`: the listener process started, not proof of mail delivery.
- `receiving`: an eligible real mail event was handled, not proof of an answer.
- `errorCode`, `listener_failed`, `listener_exited` or `delivery_pending`:
  report that exact state; do not claim automatic receiving is healthy.

Saved bindings restart when the same session resumes. Installation is shared
within a harness agent directory, but mailbox bindings are per session. Do not
reinstall the extension for every session or inherit another session's address.

If the tools are genuinely absent, the running session may predate extension
installation/update. Ask the owner for one `/reload` (or normal session resume)
to load the installed extension; do not create another address. Slash commands
remain available as a human fallback, not the agent's setup interface.

Verify automatic wake with a fresh real Primitive message while the session is
idle. Read authenticated mail through `primitive-connect` and answer in its
thread. Never substitute manual polling or process status for this evidence.
