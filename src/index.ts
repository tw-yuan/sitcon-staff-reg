import path from 'path';
import express, { NextFunction, Request, Response } from 'express';
import session from 'express-session';
import BetterSqlite3Store from 'better-sqlite3-session-store';
import { config } from './config';
import { db } from './db';
import { bootstrapSecrets, refreshConfig } from './runtimeConfig';
import { authRouter } from './routes/auth';
import { registerRouter } from './routes/register';
import { adminRouter } from './routes/admin';
import { startTelegramBot } from './services/telegramBot';

// 載入 DB 中的設定（覆蓋 env 預設），並確保 session secret / setup key 存在
void db;
refreshConfig();
const { setupKey } = bootstrapSecrets();

const app = express();
const rootDir = path.join(__dirname, '..');

app.set('view engine', 'ejs');
app.set('views', path.join(rootDir, 'views'));
app.use(express.static(path.join(rootDir, 'public')));
app.use('/form-images', express.static(path.join(path.dirname(config.databaseFile), 'form-images')));
app.use(express.urlencoded({ extended: true }));

if (config.isProd) app.set('trust proxy', 1);

const SqliteStore = BetterSqlite3Store(session);
app.use(
  session({
    store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);

app.use(authRouter);
app.use('/admin', adminRouter);
app.use(registerRouter);

app.use((_req, res) => {
  res.status(404).render('error', { title: '404', message: '找不到頁面' });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).render('error', {
    title: '發生錯誤',
    message: config.isProd ? '系統發生錯誤，請稍後再試' : String((err as Error)?.stack || err),
  });
});

startTelegramBot(); // 接收 /id 等查詢指令（long polling；未設 token 時待機）

app.listen(config.port, () => {
  console.log(`SITCON 2027 工人登錄系統啟動：${config.baseUrl}（port ${config.port}）`);
  if (config.adminEmails.length === 0) {
    console.log('');
    console.log('  ┌─────────────────────────────────────────────────────────────┐');
    console.log('  │ 尚未設定 admin。首次設定請至 /admin/login 用「設定金鑰」登入 │');
    console.log(`  │ setup key: ${setupKey}`);
    console.log('  │ 登入後到「系統設定」填入 Google 登入與 admin 名單即可         │');
    console.log('  └─────────────────────────────────────────────────────────────┘');
    console.log('');
  }
});
