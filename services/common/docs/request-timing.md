# Request processing timings

Existing consumers of `create_app` emit numeric `Server-Timing` metadata:

| Metric        | Meaning                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fv_app`      | Milliseconds from ASGI HTTP admission to response headers, including request parsing, dependencies, handler work and buffered response serialization. |
| `fv_firebase` | Aggregate milliseconds inside Firebase SDK ID-token verification, including the existing live disabled/revoked-user check.                            |

Firebase app initialization and native/delegated authentication are included in
application processing, but not the Firebase-verification-only metric. A zero
Firebase duration does not mean authorization was skipped or passed. Timing data
never grants permission or becomes a cache/write precondition.

A small FastAPI subclass encloses its final ASGI middleware stack, including error
middleware added by consumers after `create_app` returns. Routing, dependency
overrides, exception behavior, CORS, private/no-store headers and lifespan remain
available. Existing timing headers are preserved. Non-HTTP calls pass through;
invalid clocks omit metrics instead of fabricating a fast result.

Each HTTP request owns a small context-local measurement object. Worker-thread
verification contributes to that request only; concurrent and nested contexts do
not share accumulated values. State is reset on success, failure and cancellation.
Only fixed metric labels and finite, nonnegative numeric durations are emitted:
no identity, raw URL/query, credentials, request/response body or envelope data.
No additional request log, monitoring service, polling, resource or capacity change
is introduced. SDK verification and `check_revoked=True` remain unchanged.

These headers stop at response headers. They exclude container/process startup
before ASGI admission, network/proxy transit and body transfer. Streaming native
protocol work may continue afterward. Later end-to-end acceptance must measure the
complete operation and distinguish cold/warm, hit/miss/refresh and success/failure;
headers, local controlled clocks or fast errors cannot pass API500ms/UI2s targets.
Browser proxies may filter these headers and need their own numeric-only diagnostic
forwarding before browser measurements can observe backend processing.

[Foundation entry](../README.md)
