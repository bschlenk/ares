# Plugin networking

Plugins can declare HTTP(S) and WebSocket access to exact origins. A local
backend works the same way as a remote API: the plugin can fetch a chat summary,
subscribe to updates, or call its own Nano bridge. Ares implements transport and
lifecycle; it does not implement Twitch, model inference or gameplay policy.

## Manifest

```json
{
  "capabilities": ["network.request", "network.websocket"],
  "network": {
    "origins": ["http://127.0.0.1:8765", "ws://127.0.0.1:8765"]
  }
}
```

This is a fragment of a normal API-1 `manifest.json`. HTTP(S) origins require
`network.request`; WS(S) origins require `network.websocket`. Declare only the
capabilities/protocols you use. Networking capabilities require a nonempty list
of at most 32 origins. Origins are normalized and duplicate entries rejected.
Paths, query strings, fragments, credentials and wildcards are not allowed in
origin declarations. A trailing slash is accepted and normalized away.

An origin includes scheme, host and port. `http://localhost:8765`,
`http://127.0.0.1:8765`, `https://localhost:8765` and another port are separate
grants. The grant covers all paths on that origin. HTTP and WebSocket origins
must be listed separately, including when they use the same backend port.
HTTPS/WSS use normal certificate verification; there is no insecure-TLS option.
Declared DNS hostnames are resolved normally; this is an origin grant, not an IP
address pin or a public-network-only restriction.

The plugin manager shows requested origins, including a staged replacement's
origins. Enabled local plugins remain trusted: development reload accepts a
changed valid manifest using the existing reload transaction, without a new
permission dialog. Old scopes and their connections are revoked before the
replacement activates. Invalid replacements retain the old committed plugin
and its old grants; they do not partially expand access.

## HTTP and streaming responses

```ts
// Run after activation, e.g. in a command or mounted view effect.
const response = await ctx.network.fetch('http://127.0.0.1:8765/chat/summary', {
  signal: ctx.signal,
  timeoutMs: 5000,
});
if (!response.ok) throw new Error(`Backend returned ${response.status}`);
const summary = await response.json();
```

`ctx.network.fetch(url, options?)` returns a browser `Response` with status,
headers, URL, redirect flag and a pull-based `ReadableStream<Uint8Array>` body.
Use `text()`, `json()` or `body.getReader()`; decoding and SSE/NDJSON parsing
belong to the plugin. Bytes arrive before the remote response finishes. Stream
cancellation and `AbortSignal` cancel the native request. Consume or cancel each
response so it releases its slot. An HTTP 4xx/5xx returns a response normally;
transport/admission errors reject.

Supported options are `method`, a plain string-to-string `headers` object,
`body` (UTF-8 string or `Uint8Array`), `signal`, `timeoutMs` and
`maxResponseBytes`. This is a bounded subset of Fetch: `Request` objects, upload
streams, `FormData`, credential modes and arbitrary Fetch options are not
supported. GET/HEAD cannot carry a body. CONNECT/TRACE/TRACK are rejected.

The host uses no browser cookie jar, sends no page referrer and does not return
`Set-Cookie`. Explicit `Authorization` headers work; cookies, host/framing,
proxy, `sec-*` and encoding-control headers are forbidden. HTTP redirects are
followed for at most five hops, checking every destination against the manifest
before contact. Cross-origin redirects retain only explicitly supplied Accept
and Content-Type headers; other custom headers and authorization are stripped.
303 and POST 301/302 use the standard GET rewrite. Other redirect bodies remain
subject to the original origin grants and request limits.

Limits per HTTP transport:

- Four live requests/responses per plugin scope; 32 across all plugins.
- 1 MiB request body and 16 KiB aggregate supplied header names/values.
- At most 16 MiB decoded response bytes, optionally lowered with
  `maxResponseBytes`; at most 64 KiB per IPC body chunk.
- Total deadline defaults to 60 seconds; `timeoutMs` accepts 1–600,000 ms and
  includes response consumption/backpressure. It is not an idle timeout.

For a long-running SSE stream, use the explicit deadline and reconnect policy
appropriate to your backend. Ares never retries or replays requests on failure.
Response `clone()`/tee buffering is browser behavior; the native transfer budget
still applies to the one underlying body.

## WebSockets

```ts
const socket = await ctx.network.connect('ws://127.0.0.1:8765/events', {
  signal: ctx.signal,
  protocols: ['events-v1'], // optional
});
await socket.send(JSON.stringify({subscribe: 'chat-summary'}));
const reader = socket.messages.getReader();
try {
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    // Text frames are strings; binary frames are Uint8Array.
    if (typeof value === 'string') updateSummary(JSON.parse(value));
  }
} finally {
  await socket.close();
}
const {code, reason} = await socket.closed;
```

`ctx.network.connect(url, {protocols?, signal?})` returns a `PluginSocket` with
`url`, negotiated `protocol`, `messages`, `send(data)`, `close(code?, reason?)`
and `closed`. It is a stream-based API, not the browser `WebSocket` class.
`closed` resolves with close metadata after the stream reaches its terminal
message, local close or abort; consume the stream to observe remote completion.
Cancelling the stream closes the connection. A normal close ends the stream;
transport failure/overflow errors it. Application reconnection belongs to the
adapter. Protocol ping frames are answered by the host WebSocket implementation.

Limits per WebSocket transport:

- Four sockets per scope; 32 across all plugins, separately from HTTP slots.
- Ten-second handshake deadline, normal TLS verification, no redirects, cookies
  or custom handshake headers. Optional subprotocol strings are supported.
- 256 KiB per incoming/outgoing message. Compression is disabled.
- Queue at most 64 incoming messages or 1 MiB. Overflow closes the socket with
  an explicit `network_socket_overflow`; it does not silently discard messages.
- One pending read and one send per socket. Await each `send()`; concurrent sends
  or excess buffered output report `network_overload`.
- Local close accepts code 1000 or 3000–4999 and a UTF-8 reason up to 123 bytes.
  The handshake has a bounded graceful-close timeout. Unread remote-close/error
  handles expire within 30 seconds. Open sockets have no fixed lifetime limit.

The IPC pull protocol polls an otherwise idle socket internally every 30 seconds
without closing it or exposing heartbeat events. Application keepalives and
backend-specific authentication remain plugin responsibilities. Prefer keeping
Twitch credentials and chat aggregation in your local backend if that is your
application architecture; the plugin needs only that backend's origins.

## Scope, permissions and security model

Network starts require an active scope; activation/staging cannot send requests.
Use commands or mounted view effects for startup. The host rechecks the scope,
capability and origin; caller-chosen IDs cannot read/cancel another owner's work.
Abort, unload, disable, renderer teardown and game/session/epoch changes close
owned connections. Requests created synchronously during panel mounting are also
registered with that panel's existing effect cleanup. Pass the panel's `signal`
for work started later in asynchronous callbacks. No network API is added to the
emulator QuickJS bindings or the playing model.

The shared renderer keeps `connect-src 'none'`: direct `fetch`, WebSocket and
EventSource do not acquire access by adding manifest grants. Use `ctx.network`.
HTTP is performed in main, so browser CORS rules do not apply; the manifest is
the destination admission policy. Node/process launch, filesystem access,
listening servers and native sockets are not exposed by these capabilities.
Plugins still share a renderer and are trusted code, not mutually isolated
security principals. This SDK policy does not claim to sandbox a malicious
installed plugin. Keep the model's API restricted in the companion harness.

Useful error codes include `plugin_capability_denied`, `plugin_not_ready`,
`stale_plugin_scope`, `network_origin_denied`, `network_invalid_request`,
`network_invalid_limits`, `network_overload`, `network_timeout`,
`network_response_too_large`, `network_owner_denied`, `network_socket_failed`,
`network_socket_overflow` and `network_stale_request`. Errors can also retain
platform transport details. SDK user aborts use the supplied signal's reason.

Tests use disposable loopback HTTP/WebSocket servers and profiles. Coverage
includes decoded-byte limits, cross-origin redirects, missing grants, inactive
scopes, HTTP status/body behavior, streamed delivery, binary messages, overload,
abort/unload/hot-reload cleanup, changed grants and real Electron IPC.

Validation (2026-10-30): strict main/browser/preload builds and generated SDK
passed. The complete sequential suite passed 273 tests with zero failures and
one optional private-ROM skip. Eight focused networking/IPC checks passed after
final cancellation changes, as did the existing Electron plugin UI/reload test.
A copied macOS development app passed ad hoc signature verification and its
MCP/native/plugin lane, including HTTP local-summary requests and WebSocket echo
before and after hot reload. This does not claim Nano inference or a running
Twitch integration; those adapters belong to the companion plugin/backend.
