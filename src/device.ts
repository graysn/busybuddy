import type { DisplayDrawParams } from '@busy-app/busy-lib';

/**
 * Minimal direct HTTP client for the BUSY Bar device API.
 *
 * Why not just use @busy-app/busy-lib for transport? Its `DisplayDraw` (v0.17.0)
 * rebuilds the request body as `{ application_name, priority, elements }` and
 * drops `led_notification_color`, so the notification-LED blink never reaches
 * the device. The device API *does* accept that field, so we send the request
 * ourselves — mirroring the library's connection behavior (base path, version
 * negotiation, bearer token / HTTP-access password headers) so it stays a
 * faithful client.
 */

const PROXY_HOST_RE = /(^|\.)busy\.app$/i;

export interface DeviceClientOptions {
  addr: string;
  token?: string;
  httpAccessPassword?: string;
  timeout?: number;
}

export class DeviceHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'DeviceHttpError';
  }
}

export class DeviceClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly password?: string;
  private readonly timeout: number;
  private semver: string | undefined;

  constructor(opts: DeviceClientOptions) {
    let addr = opts.addr.trim();
    if (!/^https?:\/\//i.test(addr)) addr = `http://${addr}`;
    const url = new URL(addr);
    const isProxy = PROXY_HOST_RE.test(url.hostname);
    if (isProxy) url.protocol = 'https:';
    const prefix = isProxy ? '/busybar/' : '/api/';
    this.baseUrl = `${url.origin}${prefix}`;
    this.token = opts.token;
    this.password = opts.httpAccessPassword;
    this.timeout = opts.timeout ?? 3000;
  }

  private signal(): AbortSignal | undefined {
    return this.timeout > 0 ? AbortSignal.timeout(this.timeout) : undefined;
  }

  private async parse(res: Response): Promise<unknown> {
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) return res.json().catch(() => ({}));
    return res.text().catch(() => '');
  }

  private async toError(res: Response): Promise<DeviceHttpError> {
    const body = await this.parse(res);
    const msg =
      typeof body === 'object' && body !== null
        ? ((body as Record<string, string>).error ?? (body as Record<string, string>).message)
        : typeof body === 'string'
          ? body
          : undefined;
    return new DeviceHttpError(msg || `HTTP ${res.status} ${res.statusText}`, res.status, body);
  }

  /** Fetch and cache the API semantic version (required on subsequent calls). */
  private async ensureVersion(): Promise<void> {
    if (this.semver) return;
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(`${this.baseUrl}version`, { headers, signal: this.signal() });
    if (!res.ok) throw await this.toError(res);
    const body = (await this.parse(res)) as { api_semver?: string };
    if (!body.api_semver) throw new Error('Empty API version');
    this.semver = body.api_semver;
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    if (this.semver) headers['X-API-Sem-Ver'] = this.semver;
    if (this.password) headers['X-API-Token'] = this.password;
    return headers;
  }

  /**
   * Run a request, negotiating the version first and re-negotiating once on a
   * 405 (matching the official client's retry behavior).
   */
  private async request(build: () => Promise<Response>): Promise<Response> {
    await this.ensureVersion();
    let res = await build();
    if (!res.ok && res.status === 405) {
      this.semver = undefined;
      await this.ensureVersion();
      res = await build();
    }
    if (!res.ok) throw await this.toError(res);
    return res;
  }

  /** POST /display/draw with the full body, including led_notification_color. */
  async draw(params: DisplayDrawParams): Promise<void> {
    const body = JSON.stringify({ ...params, priority: params.priority ?? 50 });
    await this.request(() =>
      fetch(`${this.baseUrl}display/draw`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.authHeaders() },
        body,
        signal: this.signal(),
      }),
    );
  }

  /** DELETE /display/draw?application_name=... */
  async clear(applicationName: string): Promise<void> {
    const qs = new URLSearchParams({ application_name: applicationName }).toString();
    await this.request(() =>
      fetch(`${this.baseUrl}display/draw?${qs}`, {
        method: 'DELETE',
        headers: this.authHeaders(),
        signal: this.signal(),
      }),
    );
  }
}
