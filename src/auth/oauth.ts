import { randomBytes } from 'crypto';
import { callbackUrl } from '../config';
import { getProvider, ProviderName, NormalizedProfile } from './providers';

export function randomState(): string {
  return randomBytes(16).toString('hex');
}

export function buildAuthUrl(name: ProviderName, state: string): string {
  const p = getProvider(name);
  const params = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: callbackUrl(name),
    response_type: 'code',
    scope: p.scope,
    state,
  });
  return `${p.authorizeUrl}?${params.toString()}`;
}

async function exchangeCode(name: ProviderName, code: string): Promise<string> {
  const p = getProvider(name);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrl(name),
    client_id: p.clientId,
    client_secret: p.clientSecret,
  });
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`${name} token exchange failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!json.access_token) {
    throw new Error(`${name} token exchange returned no access_token: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

async function fetchProfile(name: ProviderName, accessToken: string): Promise<NormalizedProfile> {
  const p = getProvider(name);
  const res = await fetch(p.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'sitcon-staff-reg',
    },
  });
  if (!res.ok) {
    throw new Error(`${name} userinfo failed: ${res.status} ${await res.text()}`);
  }
  const user = (await res.json()) as Record<string, unknown>;
  return p.parse(user);
}

/** 用 authorization code 換 profile。 */
export async function handleCallback(name: ProviderName, code: string): Promise<NormalizedProfile> {
  const accessToken = await exchangeCode(name, code);
  return fetchProfile(name, accessToken);
}
