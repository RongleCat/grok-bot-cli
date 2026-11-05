import { OAUTH_CLIENT_ID, OAUTH_TOKEN_URL, REFRESH_SKEW_MS } from './constants.mjs';
import { publicSession, removeFile, writeSecret } from './config.mjs';
import { CliError } from './errors.mjs';

export function jwtExpMs(token) {
  if (typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Missing exp refreshes. Otherwise refresh inside the 5 minute skew.
export function shouldRefreshAccessToken(accessToken, now) {
  const exp = jwtExpMs(accessToken);
  if (exp == null) return true;
  return exp - now < REFRESH_SKEW_MS;
}

export async function refreshSession(ctx, session) {
  if (!session.refreshToken || session.source !== 'file') {
    throw new CliError('NOT_LOGGED_IN', 'Credentials were rejected. Run: grok-bot login', 2);
  }
  let response;
  try {
    response = await ctx.fetchImpl(OAUTH_TOKEN_URL, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: OAUTH_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
      }),
    });
  } catch {
    throw new CliError('NETWORK', 'Could not reach the token endpoint.', 4);
  }
  let data;
  try {
    data = JSON.parse(await response.text());
  } catch {
    throw new CliError('AUTH_REFRESH_FAILED', 'The token endpoint returned an unreadable body. Run: grok-bot login', 2);
  }
  if (data?.shouldLogout === true) {
    await removeFile(session.path);
    throw new CliError('AUTH_REVOKED', 'The session was revoked. Run: grok-bot login', 2);
  }
  if (!response.ok || typeof data?.access_token !== 'string' || !data.access_token) {
    throw new CliError('AUTH_REFRESH_FAILED', 'The access token could not be refreshed. Run: grok-bot login', 2);
  }
  const next = {
    ...session,
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : session.refreshToken,
    source: 'file',
    refreshed: true,
  };
  await writeSecret(session.path, `${JSON.stringify(publicSession(next))}\n`);
  return next;
}
