# Local model infrastructure and current limits

Electron is pinned to 45.1.0. Its local AI handler API is available, but Ares has
**no configured model provider** and does not bundle Gemini Nano, Chrome model
weights, an echo backend or a cloud fallback. A renderer's
`LanguageModel.availability()` result alone is not an inference readiness check.

The trusted MCP/CLI `build_info --app true` report distinguishes:

- `runtime.electron`, `runtime.chromium`, `runtime.node`: the actual running app.
- `local_models.local_ai_handler_supported`: runtime handler API support.
- `local_models.provider: "none"`, `usable: false`, and
  `reason: "provider_not_configured"`: the current backend state.

These fields do not grant model or emulator permissions to a player script. A
future Chrome bridge must implement real create/prompt/stream/abort/destroy,
validate its backend with inference, and manage readiness, cancellation and
reconnection. Provider registration is a trusted host concern. Downloaded Chrome
models stay managed by Chrome. Durable plugin journaling and checkpoint metadata
coordination remain separate work.

The isolated `npm run test:local-ai` checks Electron's real renderer/utility
process connection using a test-only provider that reports `unavailable` and
rejects model creation. It does not claim Nano inference. This check is included
in the fixture acceptance lane. Ordinary session, plugin/reload, input, capture,
packaging and ad-hoc signing checks remain applicable to runtime upgrades.

Official integration references:
[localAIHandler](https://www.electronjs.org/docs/latest/api/local-ai-handler),
[LanguageModelUtility](https://www.electronjs.org/docs/latest/api/language-model-utility),
[session registration](https://www.electronjs.org/docs/latest/api/session#sesregisterlocalaihandlerhandler),
and [Electron Prompt API RFC](https://github.com/electron/rfcs/blob/main/text/0014-ai-prompt-api.md).

## Validation (2026-10-30)

- Installed runtime: Electron 45.1.0, Chromium 156.0.8078.49, bundled Node 24.22.1.
- Strict TypeScript/SDK builds; sequential regression suite: 247 passed, zero failures, one optional private-ROM test skipped.
- Real utility-handler unavailable/create-rejection test passed. Disposable actual Electron session, plugin/hot-reload and agent diagnostic tests passed.
- Fresh temporary macOS bundle packaged and ad-hoc signed; `codesign --verify --deep --strict` passed. Copied-package MCP/native-loader/TSX reload/CLI checks passed with checkout reads denied (`PACKAGE_MCP_PASS`, 799 GB frames).
- No Developer ID/notarization claim and no real-model inference claim. A bridge implementation/protocol is still needed before a usable provider can be connected.
