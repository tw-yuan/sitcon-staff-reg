import { config } from '../config';

export type ProviderName = 'google' | 'github' | 'gitlab';
export const WORKER_PROVIDERS: ProviderName[] = ['google', 'github', 'gitlab'];

export interface NormalizedProfile {
  id: string;
  username: string; // github login / gitlab username；google 以 email 前綴代替
  email: string;
}

export interface ProviderDef {
  name: ProviderName;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
  clientId: string;
  clientSecret: string;
  parse: (user: Record<string, unknown>) => NormalizedProfile;
}

export function getProvider(name: ProviderName): ProviderDef {
  switch (name) {
    case 'google':
      return {
        name,
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
        scope: 'openid email profile',
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
        parse: (u) => ({
          id: String(u.sub ?? ''),
          username: String(u.email ?? '').split('@')[0],
          email: String(u.email ?? ''),
        }),
      };
    case 'github':
      return {
        name,
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userInfoUrl: 'https://api.github.com/user',
        scope: 'read:user',
        clientId: config.github.clientId,
        clientSecret: config.github.clientSecret,
        parse: (u) => ({
          id: String(u.id ?? ''),
          username: String(u.login ?? ''),
          email: String(u.email ?? ''),
        }),
      };
    case 'gitlab':
      return {
        name,
        authorizeUrl: `${config.gitlab.baseUrl}/oauth/authorize`,
        tokenUrl: `${config.gitlab.baseUrl}/oauth/token`,
        userInfoUrl: `${config.gitlab.baseUrl}/api/v4/user`,
        scope: 'read_user',
        clientId: config.gitlab.clientId,
        clientSecret: config.gitlab.clientSecret,
        parse: (u) => ({
          id: String(u.id ?? ''),
          username: String(u.username ?? ''),
          email: String(u.email ?? ''),
        }),
      };
  }
}
