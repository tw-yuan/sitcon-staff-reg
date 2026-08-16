import { Router } from 'express';
import { buildAuthUrl, handleCallback, randomState } from '../auth/oauth';
import { getProvider, ProviderName, WORKER_PROVIDERS } from '../auth/providers';
import { isAdminEmail } from '../auth/session';
import { verifyTelegramAuth } from '../auth/telegram';

export const authRouter = Router();

function isProviderName(v: string): v is ProviderName {
  return (WORKER_PROVIDERS as string[]).includes(v);
}

// Telegram Login Widget 以 GET 導回（帶簽章參數）。
// 必須註冊在下面的 /auth/:provider 之前，否則會被通用路由攔截成「未知的登入來源」。
authRouter.get('/auth/telegram/callback', (req, res) => {
  const profile = verifyTelegramAuth(req.query as Record<string, unknown>);
  if (!profile) {
    req.session.flash = 'Telegram 驗證失敗：請確認 Bot Token 正確、且已在 BotFather /setdomain 設定網域';
    res.redirect('/');
    return;
  }
  const linked = req.session.linked || {};
  linked.telegram = { id: profile.id, username: profile.username };
  req.session.linked = linked;
  res.redirect('/');
});

authRouter.get('/auth/:provider', (req, res) => {
  const provider = req.params.provider;
  if (!isProviderName(provider)) {
    res.status(404).send('未知的登入來源');
    return;
  }
  const mode = req.query.mode === 'admin' ? 'admin' : 'worker';
  if (mode === 'admin' && provider !== 'google') {
    res.status(400).send('admin 僅支援 Google 登入');
    return;
  }
  const def = getProvider(provider);
  if (!def.clientId || !def.clientSecret) {
    res.status(503).render('error', {
      title: '尚未設定',
      message: `${provider} OAuth 尚未在 .env 設定，請聯絡系統管理員。`,
    });
    return;
  }
  const state = randomState();
  req.session.oauth = { state, provider, mode };
  res.redirect(buildAuthUrl(provider, state));
});

authRouter.get('/auth/:provider/callback', async (req, res, next) => {
  const provider = req.params.provider;
  if (!isProviderName(provider)) {
    res.status(404).send('未知的登入來源');
    return;
  }
  const { code, state } = req.query;
  const o = req.session.oauth;
  if (!o || o.provider !== provider || !state || o.state !== state) {
    req.session.flash = '登入 state 驗證失敗，請重試';
    res.redirect(o?.mode === 'admin' ? '/admin/login' : '/');
    return;
  }
  req.session.oauth = undefined;
  try {
    const profile = await handleCallback(provider, String(code));

    if (o.mode === 'admin') {
      if (!profile.email || !isAdminEmail(profile.email)) {
        req.session.flash = '此 Google 帳號不在行政組名單內';
        res.redirect('/admin/login');
        return;
      }
      req.session.admin = { email: profile.email };
      res.redirect('/admin');
      return;
    }

    const linked = req.session.linked || {};
    if (provider === 'google') linked.google = { email: profile.email, sub: profile.id };
    if (provider === 'github') linked.github = { login: profile.username, id: profile.id };
    if (provider === 'gitlab') linked.gitlab = { username: profile.username, id: profile.id };
    req.session.linked = linked;
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

authRouter.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

authRouter.get('/admin/logout', (req, res) => {
  req.session.admin = undefined;
  res.redirect('/admin/login');
});
