import axios from 'axios';

/**
 * InternalClient is an injectable HTTP client for synchronous inter-service
 * RPC calls. Its `.send()` signature mirrors NestJS `ClientProxy.send()` so
 * callers swap mechanically.
 *
 * Migration note for Phase 2:
 * - OLD: `await firstValueFrom(clientProxy.send({ cmd: 'X' }, payload))`
 * - NEW: `await internalClient.send({ cmd: 'X' }, payload)`
 *
 * Drop the `firstValueFrom` wrapper — InternalClient returns a plain Promise.
 */
export class InternalClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  /**
   * Send an RPC call to the peer service's `/internal/rpc` endpoint.
   *
   * @param pattern - Object with a `cmd` string (e.g. `{ cmd: 'GET_COURSE' }`).
   *   Same shape as NestJS MessagePattern keys.
   * @param payload - Arbitrary payload forwarded as the request body `payload` field.
   * @returns Promise resolving to the peer's response data (unwrapped from axios).
   *
   * Note for Phase 2 callers: this returns a Promise, not an Observable.
   * Remove `firstValueFrom(...)` / `lastValueFrom(...)` wrappers when switching.
   */
  async send<T = unknown>(
    pattern: { cmd: string },
    payload: unknown,
  ): Promise<T> {
    const res = await axios.post<T>(
      `${this.baseUrl}/internal/rpc`,
      { cmd: pattern.cmd, payload },
      {
        headers: { 'x-internal-token': this.token },
      },
    );
    return res.data;
  }
}
