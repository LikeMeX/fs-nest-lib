/**
 * Deterministic cmd→route mapping
 *
 * Rules (from the transport-migration plan):
 *
 * 1. `GET_<NOUN>` + scalar payload  → `GET /internal/<noun>/:id`
 * 2. `GET_<NOUN>` + object payload  → `GET /internal/<noun>?<query>`
 *    If payload is too large for a query string → `POST /internal/<noun>/query` (body)
 * 3. `CREATE_<NOUN>`                → `POST   /internal/<noun>`
 * 4. `UPDATE_<NOUN>`                → `PUT    /internal/<noun>`
 * 5. `DELETE_<NOUN>`                → `DELETE /internal/<noun>`
 * 6. Any cmd                        → also reachable via `POST /internal/rpc` tunnel
 *
 * Noun mapping: `GET_BIZ_MEMBER` → `/internal/biz-member` (multi-word kebab-case).
 *
 * This function encodes the deterministic part — Phase 2 uses it to generate
 * REST routes alongside the RPC tunnel without any per-cmd judgment.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface CmdRoute {
  method: HttpMethod;
  /** e.g. `/internal/course/:id` or `/internal/biz-member` */
  path: string;
  /**
   * 'id-param'  → caller appends `:id` for scalar payloads
   * 'query'     → caller builds query string from object payload
   * 'body'      → caller POSTs body (mutations or fat-query fallback)
   */
  payloadStyle: 'id-param' | 'query' | 'body';
}

/**
 * Convert a CMD string to its canonical HTTP route descriptor.
 *
 * @param cmd - e.g. `'GET_COURSE'`, `'GET_BIZ_MEMBER'`, `'CREATE_ENROLLMENT'`
 * @param opts.scalarPayload - when true, GET routes use `/:id` param style
 *        rather than query string. Defaults to false (query style).
 * @param opts.fatQuery - when true, GET routes use POST /noun/query body style.
 *        Mutually exclusive with scalarPayload; fatQuery takes precedence.
 *
 * @example
 * cmdToRoute('GET_COURSE')              // { method:'GET', path:'/internal/course',       payloadStyle:'query' }
 * cmdToRoute('GET_COURSE', {scalarPayload:true})
 *                                       // { method:'GET', path:'/internal/course/:id',   payloadStyle:'id-param' }
 * cmdToRoute('GET_BIZ_MEMBER')          // { method:'GET', path:'/internal/biz-member',   payloadStyle:'query' }
 * cmdToRoute('CREATE_ENROLLMENT')       // { method:'POST', path:'/internal/enrollment',  payloadStyle:'body' }
 * cmdToRoute('UPDATE_COURSE')           // { method:'PUT',  path:'/internal/course',      payloadStyle:'body' }
 * cmdToRoute('DELETE_COURSE')           // { method:'DELETE', path:'/internal/course',    payloadStyle:'body' }
 */
export function cmdToRoute(cmd: string, opts: { scalarPayload?: boolean; fatQuery?: boolean } = {}): CmdRoute {
  const upper = cmd.toUpperCase();

  // Extract verb prefix and noun tail
  const getMatch = upper.match(/^GET_(.+)$/);
  const createMatch = upper.match(/^CREATE_(.+)$/);
  const updateMatch = upper.match(/^UPDATE_(.+)$/);
  const deleteMatch = upper.match(/^DELETE_(.+)$/);

  if (getMatch) {
    const noun = toKebab(getMatch[1]);
    const basePath = `/internal/${noun}`;

    if (opts.fatQuery) {
      return { method: 'POST', path: `${basePath}/query`, payloadStyle: 'body' };
    }
    if (opts.scalarPayload) {
      return { method: 'GET', path: `${basePath}/:id`, payloadStyle: 'id-param' };
    }
    return { method: 'GET', path: basePath, payloadStyle: 'query' };
  }

  if (createMatch) {
    const noun = toKebab(createMatch[1]);
    return { method: 'POST', path: `/internal/${noun}`, payloadStyle: 'body' };
  }

  if (updateMatch) {
    const noun = toKebab(updateMatch[1]);
    return { method: 'PUT', path: `/internal/${noun}`, payloadStyle: 'body' };
  }

  if (deleteMatch) {
    const noun = toKebab(deleteMatch[1]);
    return { method: 'DELETE', path: `/internal/${noun}`, payloadStyle: 'body' };
  }

  // Unknown verb — treat as POST body (tunnel handles it)
  const noun = toKebab(cmd);
  return { method: 'POST', path: `/internal/${noun}`, payloadStyle: 'body' };
}

/**
 * Convert `SNAKE_CASE_NOUN` to `kebab-case-noun`.
 * `BIZ_MEMBER` → `biz-member`, `COURSE` → `course`.
 */
function toKebab(noun: string): string {
  return noun.toLowerCase().replace(/_/g, '-');
}
