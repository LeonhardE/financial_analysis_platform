/** Optional Owner SDK. Inject authenticated transport; persist the original signed command first. */
export class ProviderConnectionClient {
  constructor(request) {
    if (typeof request !== "function") throw Error("invalid_transport");
    this.request = request;
  }
  path(vault, provider) {
    if (
      typeof vault !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(vault) ||
      !["muse", "chatgpt"].includes(provider)
    )
      throw Error("invalid_connection");
    return `/api/v3/provider-connections/${vault}/${provider}`;
  }
  send(path, options) {
    return this.request(path, {
      ...options,
      headers: { "X-FolioView-Contract": "folioview.agent-workspace.v2.0", ...options.headers },
    });
  }
  state(vault, provider) {
    return this.send(this.path(vault, provider), { method: "GET" });
  }
  receipt(vault, provider, operation) {
    this.operation(operation);
    return this.send(`${this.path(vault, provider)}/operations/${operation}`, { method: "GET" });
  }
  operation(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{22,128}$/.test(value))
      throw Error("invalid_operation");
  }
  submit(vault, provider, command, operation) {
    this.operation(operation);
    const body = JSON.stringify({ contractVersion: "folioview.agent-workspace.v2.0", command });
    if (new TextEncoder().encode(body).length > 140000) throw Error("payload_too_large");
    // One write only: an uncertain response is recovered via receipt/original packet.
    return this.send(`${this.path(vault, provider)}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": operation },
      body,
    });
  }
}
