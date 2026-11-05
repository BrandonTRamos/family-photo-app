// The HTTP API: routes, sign-in and membership checks, and error mapping. Runs in Lambda and, for the preview, in the browser.
import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { Archive } from './archive.js';
import { DomainError, type Person } from './domain.js';
import type { Deps } from './ports.js';

interface Principal extends Person {
  groups: string[];
}

type Route = {
  method: string;
  pattern: RegExp;
  member: boolean;
  run: (ctx: { user: Principal; params: string[]; query: Record<string, string | undefined>; body: unknown }) => Promise<unknown>;
};

export function makeHttpHandler(deps: Deps): APIGatewayProxyHandlerV2 {
  const archive = new Archive(deps);
  const routes: Route[] = [
    { method: 'GET', pattern: /^\/me$/, member: false, run: async ({ user }) => ({ name: user.name, member: user.groups.includes(deps.config.familyGroup) }) },
    { method: 'GET', pattern: /^\/timeline$/, member: true, run: ({ query }) => archive.timeline(query) },
    { method: 'GET', pattern: /^\/undated$/, member: true, run: ({ query }) => archive.undated(query) },
    { method: 'GET', pattern: /^\/search$/, member: true, run: ({ query }) => archive.search(query) },
    { method: 'GET', pattern: /^\/items\/([^/]+)$/, member: true, run: ({ params }) => archive.item(params[0]) },
    { method: 'POST', pattern: /^\/items\/([^/]+)\/tags$/, member: true, run: ({ user, params, body }) => archive.addTag(user, params[0], body) },
    { method: 'DELETE', pattern: /^\/items\/([^/]+)\/tags\/([^/]+)$/, member: true, run: ({ params }) => archive.removeTag(params[0], params[1]) },
    { method: 'PUT', pattern: /^\/items\/([^/]+)\/capture-date$/, member: true, run: ({ params, body }) => archive.setCaptureDate(params[0], body) },
    { method: 'POST', pattern: /^\/uploads$/, member: true, run: ({ user, body }) => archive.requestUploads(user, body) },
    { method: 'POST', pattern: /^\/uploads\/([^/]+)\/complete$/, member: true, run: ({ user, params, body }) => archive.completeUpload(user, params[0], body) },
    { method: 'GET', pattern: /^\/albums$/, member: true, run: () => archive.listAlbums() },
    { method: 'POST', pattern: /^\/albums$/, member: true, run: ({ user, body }) => archive.createAlbum(user, body) },
    { method: 'GET', pattern: /^\/albums\/([^/]+)$/, member: true, run: ({ params, query }) => archive.album(params[0], query) },
    { method: 'DELETE', pattern: /^\/albums\/([^/]+)$/, member: true, run: ({ params }) => archive.deleteAlbum(params[0]) },
    { method: 'POST', pattern: /^\/albums\/([^/]+)\/items$/, member: true, run: ({ params, body }) => archive.addToAlbum(params[0], body) },
    { method: 'DELETE', pattern: /^\/albums\/([^/]+)\/items\/([^/]+)$/, member: true, run: ({ params }) => archive.removeFromAlbum(params[0], params[1]) },
  ];

  return async (event) => {
    try {
      const user = principalFrom(event);
      if (!user) return json(401, { error: 'unauthorized', message: 'Please sign in.' });
      const method = event.requestContext.http.method.toUpperCase();
      const path = (event.rawPath || '/').replace(/\/+$/, '') || '/';
      let pathMatched = false;
      for (const route of routes) {
        const m = route.pattern.exec(path);
        if (!m) continue;
        pathMatched = true;
        if (route.method !== method) continue;
        if (route.member && !user.groups.includes(deps.config.familyGroup)) {
          return json(403, { error: 'not_a_member', message: 'Ask a family member to add you to the Archive.' });
        }
        const result = await route.run({
          user,
          params: m.slice(1).map(decodeURIComponent),
          query: event.queryStringParameters ?? {},
          body: parseBody(event),
        });
        return json(200, result);
      }
      return pathMatched
        ? json(405, { error: 'method_not_allowed', message: 'That action is not supported here.' })
        : json(404, { error: 'not_found', message: 'Nothing here.' });
    } catch (err) {
      if (err instanceof DomainError) return json(err.status, { error: err.code, message: err.message });
      console.error(err);
      return json(500, { error: 'internal', message: 'Something went wrong. Please try again.' });
    }
  };
}

function principalFrom(event: APIGatewayProxyEventV2): Principal | undefined {
  const claims = (event.requestContext as { authorizer?: { jwt?: { claims?: Record<string, unknown> } } }).authorizer?.jwt
    ?.claims;
  const sub = claims?.sub;
  if (typeof sub !== 'string' || !sub) return undefined;
  const name = [claims!.name, claims!.given_name, claims!.email].find((v) => typeof v === 'string' && v) as string | undefined;
  return { id: sub, name: name ?? 'Family member', groups: parseGroups(claims!['cognito:groups']) };
}

/** API Gateway passes groups as "[a b]" or "a,b" depending on the token; accept both and arrays. */
function parseGroups(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string') return [];
  return raw
    .replace(/^\[|\]$/g, '')
    .split(/[\s,]+/)
    .filter(Boolean);
}

function parseBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return undefined;
  const text = event.isBase64Encoded
    ? new TextDecoder().decode(Uint8Array.from(atob(event.body), (c) => c.charCodeAt(0)))
    : event.body;
  try {
    return JSON.parse(text);
  } catch {
    throw new DomainError(400, 'invalid_json', 'The request could not be read.');
  }
}

function json(statusCode: number, body: unknown) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
