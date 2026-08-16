import 'express-session';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import type { Identity } from '../models/submissions';

declare module 'express-session' {
  interface SessionData {
    oauth?: { state: string; provider: 'google' | 'github' | 'gitlab'; mode: 'worker' | 'admin' };
    linked?: {
      google?: { email: string; sub: string };
      github?: { login: string; id: string };
      gitlab?: { username: string; id: string };
      telegram?: { id: string; username: string };
    };
    admin?: { email: string };
    flash?: string;
  }
}

export function allLinked(req: Request): boolean {
  const l = req.session.linked || {};
  return !!(l.google && l.github && l.gitlab && l.telegram);
}

export function sessionIdentity(req: Request): Identity | null {
  const l = req.session.linked;
  if (!l || !l.google || !l.github || !l.gitlab || !l.telegram) return null;
  return {
    googleEmail: l.google.email,
    googleSub: l.google.sub,
    githubLogin: l.github.login,
    githubId: l.github.id,
    gitlabUsername: l.gitlab.username,
    gitlabId: l.gitlab.id,
    telegramId: l.telegram.id,
    telegramUsername: l.telegram.username,
  };
}

export function isAdminEmail(email: string): boolean {
  return config.adminEmails.includes(email.toLowerCase());
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.session.admin) {
    next();
    return;
  }
  req.session.flash = '請先以行政組帳號登入';
  res.redirect('/admin/login');
}

/** 取出並清除一次性提示訊息。 */
export function takeFlash(req: Request): string {
  const f = req.session.flash;
  req.session.flash = undefined;
  return f || '';
}
