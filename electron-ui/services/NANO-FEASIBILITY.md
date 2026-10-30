# Nano feasibility and ownership assessment

Assessment date: 2026-10-30. This is an architecture/source review, not a claim
that real Nano inference has been demonstrated in Ares. No Chrome profile,
installation, model download or running emulator was changed for this review.

Follow-up: generic HTTP streaming and WebSockets are now implemented through
[manifest-declared plugin networking](../plugins/NETWORK.md). This assessment
remains a source review; no Nano bridge or real inference is supplied by Ares.

## Decision

Pursue an optional, separately usable Chrome provider bridge. Keep model choice,
prompts, player context, output validation and gameplay tools in the companion
plugin. Start with a generic, capability-controlled network request/streaming API in
Ares, allowing plugins to talk to independently running providers. Add managed
helper lifecycle only if the inference spike establishes that it is needed. Do not make Chrome/Nano a
required emulator dependency or expose arbitrary process/network access to
ordinary plugins to make this work.

This avoids repeating browser installation, reconnection and cancellation code
in every game plugin, while allowing other local providers later. Nothing belongs
in a hardware core. The existing Electron local-AI-handler mechanism is an
optional facade over a proven provider; it is not a prerequisite for the spike.
Do not register it app-wide until caller/session isolation and lifecycle are
implemented. Generic brokered network requests can provide plugin ownership first; a
model-specific SDK service is not required to reach an HTTP/SSE provider.

## Evidence and feasibility

[Chrome's Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api)
identifies Gemini Nano as its backend and describes creation, streaming, abort and
session destruction. Model download and hardware eligibility remain Chrome's
responsibility. Initial setup may require user activation. A fresh profile is
not ready just because another Chrome profile has downloaded a model. Web workers
are not a substitute for a supported document context. Google's
[extension sample](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/ai.gemini-on-device)
uses an extension page to create and prompt the model.

[Electron's localAIHandler](https://www.electronjs.org/docs/latest/api/local-ai-handler)
and [LanguageModelUtility](https://www.electronjs.org/docs/latest/api/language-model-utility)
let an application provide its own backend in a utility process. They do not
supply Chrome's model. Ares already has Electron 45.1.0 and an isolated handler
wiring test, but that test deliberately reports unavailable. Its success is not
Nano inference evidence. The installed Chrome binary reports 156.0.8078.76 via
its application metadata; this also proves nothing about model readiness.

A Chrome-hosted model with local request/result transport is therefore a
credible approach. Completely headless first-run download, unattended startup
and long-running reliability remain unverified on this machine. They must not
be promised based on browser flags or an availability response.

## A concrete wrapper audit

I inspected [r/google-nano-openai's server source](https://github.com/r/google-nano-openai/blob/main/server.ts),
not just its setup instructions. It implements an actual Chrome page calling
`LanguageModel.create()` and `prompt()`, relayed through HTTP/SSE. That is useful
prototype code. The reviewed implementation ignores streaming, has no request
abort path, uses millisecond timestamps as job IDs, and marks readiness from
availability alone. Its listener omits a bind address, with no authentication or
body-size/admission bound. A server timeout does not cancel browser inference.
Its automatic-download path has no user-activation handling. I would not adopt
it unchanged or treat its README as proof that setup works on our target.

Those findings apply to the reviewed source, not every guide or wrapper. The
user's specific guides have not been supplied or individually evaluated.

## Responsibility split

| Piece | Responsibility |
| --- | --- |
| Chrome + optional provider helper | Chrome-owned model setup, real inference, browser/document lifecycle, model sessions, stream/abort/destroy, version/readiness diagnostics |
| Ares Electron host | Generic network requests/streaming with declared origin grants, owner-scoped cancellation and bounded work; optional managed-helper lifecycle if later required |
| Companion plugin | Setup/status UI, provider selection, prompts and history, recovered journal context, structured-output checks, restricted gameplay API and strategy |
| Emulator core | Existing generic input, timing, display and memory services; no model dependency |

This split is a recommendation, not an implemented SDK contract. Ordinary Ares
plugins currently have Node integration disabled and share an app page whose
CSP has `connect-src 'none'`. There is no arbitrary native-socket/process-launch SDK. A
plugin must use the new brokered networking API to fetch a local Nano wrapper;
it still cannot start Chrome by itself.
Enabling unrestricted renderer networking or Node is unnecessary for this feature.

For an initial spike, a dedicated Chrome page/profile and a local relay are
simpler to inspect than full Electron Prompt API emulation. For distribution,
a Chrome extension page plus
[native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
is another credible transport: Chrome starts an allowlisted native helper over
stdio; that helper can relay to a private application socket. Extension install,
first-run setup and reconnection still need testing. This is not a claim that an
Ares renderer can call Chrome extension messaging directly.

If CDP is used for development, use a separate owned profile and a pipe. Chrome
[restricts remote debugging of default profiles](https://developer.chrome.com/blog/remote-debugging-port).
No normal browsing profile or downloaded weights need to be copied. A loopback
HTTP prototype needs explicit loopback binding/authentication/origin checks and
bounded messages; the product need not expose an HTTP listening service at all.

## Proof required before host integration

1. In a separate Chrome profile, complete Chrome-managed setup and generate real
   transformed answers to several changing prompts. Reject echo/stub responses;
   report API support, download state and successful inference separately.
2. Exercise persistent sessions, actual streaming, abort during inference,
   deadlines and destroy. Measure warm/cold latency and context limits. Do not
   infer tool-calling support from an OpenAI-shaped HTTP envelope.
3. Kill only the test browser/helper, verify pending requests fail promptly and
   are never replayed, then reconnect. Test sleep/wake and unattended restart
   after initial user setup; compare headed and headless operation.
4. Prove independent caller histories, bounded admission, unload cancellation
   and no secret/transport credentials in model-visible prompts. Model output
   receives only the companion's restricted game API.
5. Validate the installed/copied Ares app can reach the helper without checkout
   dependencies before offering a model facade or managed-helper capability, if either is
   needed. Generic network transport need not be Nano-specific.

Real inference feasibility is promising; operational feasibility remains an
experiment. Model usefulness for playing Pokemon is a separate plugin evaluation.
This review does not install or endorse a third-party wrapper as production code.

## Network capability direction

All Ares plugins already have a strict `manifest.json` with declared capabilities.
The follow-up implementation adds `network.request` and `network.websocket`,
with a manifest list of permitted origins (scheme, host and port) and host-brokered
requests, streams and sockets. The exact API is documented in
[NETWORK.md](../plugins/NETWORK.md), including the separate `network.websocket`
grant. Show requested access in the
plugin manager and make permission expansion visible on updates.

The host should check the destination and redirects, avoid inheriting browser
cookies, bound transfers/concurrency, and cancel on scope disposal. Keep the
renderer CSP restrictive rather than adding every plugin's domains to one shared
page allowlist. Plugins currently share a renderer/JavaScript environment and
are explicitly trusted code; SDK checks do not establish a Chrome-extension-style
security sandbox against a malicious installed plugin. Strong per-plugin isolation
would be a separate execution-context project.

A declared local HTTP origin plus generic streaming requests is sufficient for a
plugin to consume an already running Nano HTTP/SSE bridge. The plugin owns the
wire protocol adapter. It does not supply Chrome, install an extension, launch a
native helper or expose Chrome's `LanguageModel` inside Electron. Those setup and
process-management concerns remain separate from network permission.

Chrome's [manifest permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
and [extension network model](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
are useful precedents for declared host access, but Ares does not inherit their
per-extension origin isolation just by adopting similarly named manifest fields.
