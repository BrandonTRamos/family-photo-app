// A `fetch` that serves the HTTP API and storage uploads in-process instead of over the network.
// The web client's HttpApiClient runs on it unchanged: the browser preview uses it, and so do the tests,
// so they cover the real client, the real routes and the real upload protocol. Runs anywhere (no Node APIs).
import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';

export interface Caller {
  sub: string;
  name: string;
  groups: string[];
}

export interface InProcessOptions {
  /** Requests under this URL go to the API handler. */
  apiBase: string;
  api: APIGatewayProxyHandlerV2;
  /** Who a bearer token belongs to, like the JWT authorizer. Undefined means signed out. */
  caller: (token: string | undefined) => Caller | undefined;
  /** A PUT to an upload grant URL. Returns the stored part's ETag. */
  store: (url: string, body: Uint8Array, contentType: string | undefined) => string;
}

export function inProcessFetch(opts: InProcessOptions): typeof fetch {
  const base = opts.apiBase.replace(/\/$/, '');
  return async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init.headers);
    const method = (init.method ?? 'GET').toUpperCase();
    if (url.startsWith(base + '/')) {
      const token = headers.get('authorization')?.replace(/^Bearer /, '');
      const body = init.body === undefined || init.body === null ? undefined : String(init.body);
      const event = apiEvent(method, url.slice(base.length), body, opts.caller(token));
      const res = (await opts.api(event, {} as never, () => undefined)) as { statusCode: number; headers?: Record<string, string>; body?: string };
      return new Response(res.body ?? null, { status: res.statusCode, headers: res.headers });
    }
    if (method === 'PUT') {
      const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
      try {
        const etag = opts.store(url, bytes, headers.get('content-type') ?? undefined);
        return new Response(null, { status: 200, headers: { etag } });
      } catch {
        return new Response(null, { status: 404 });
      }
    }
    return new Response(null, { status: 404 });
  };
}

/** The event API Gateway (HTTP API, payload v2) hands the Lambda, with JWT claims for the caller. */
export function apiEvent(method: string, pathAndQuery: string, body: string | undefined, caller: Caller | undefined): APIGatewayProxyEventV2 {
  const [rawPath, rawQuery = ''] = pathAndQuery.split('?');
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath,
    rawQueryString: rawQuery,
    headers: { 'content-type': 'application/json' },
    queryStringParameters: rawQuery ? Object.fromEntries(new URLSearchParams(rawQuery)) : undefined,
    requestContext: {
      http: { method, path: rawPath, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'in-process' },
      authorizer: caller
        ? { jwt: { claims: { sub: caller.sub, name: caller.name, 'cognito:groups': `[${caller.groups.join(' ')}]` }, scopes: null } }
        : undefined,
    },
    body,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}
