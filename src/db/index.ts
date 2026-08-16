import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { config } from '../config';

const dir = path.dirname(config.databaseFile);
fs.mkdirSync(dir, { recursive: true });

export const db: Database.Database = new Database(config.databaseFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

migrate();

function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sections (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      description TEXT,
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fields (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      key           TEXT NOT NULL UNIQUE,
      label         TEXT NOT NULL,
      help_text     TEXT,
      type          TEXT NOT NULL,
      required      INTEGER NOT NULL DEFAULT 0,
      options_json  TEXT,
      regex         TEXT,
      regex_message TEXT,
      allow_other   INTEGER NOT NULL DEFAULT 0,
      section_id        INTEGER,
      option_jumps_json TEXT,
      content       TEXT,
      image_path    TEXT,
      position      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workgroups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS permission_grants (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workgroup_id INTEGER NOT NULL REFERENCES workgroups(id) ON DELETE CASCADE,
      platform     TEXT NOT NULL,          -- 'drive' | 'gitlab' | 'github'
      target       TEXT NOT NULL,          -- 資源識別碼（folder id / group path / org-team-repo）
      role         TEXT NOT NULL,          -- viewer / developer / member ...
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      identity_key    TEXT NOT NULL UNIQUE, -- 以 google email 為主
      google_email    TEXT,
      google_sub      TEXT,
      github_login    TEXT,
      github_id       TEXT,
      gitlab_username TEXT,
      gitlab_id       TEXT,
      telegram_id       TEXT,
      telegram_username TEXT,
      workgroup_id    INTEGER REFERENCES workgroups(id) ON DELETE SET NULL,
      answers_json    TEXT NOT NULL DEFAULT '{}',
      status          TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
      sheet_row       INTEGER,
      reject_reason   TEXT,
      reviewed_by     TEXT,
      reviewed_at     TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS provisioning_tasks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      platform      TEXT NOT NULL,
      target        TEXT NOT NULL,
      role          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending', -- pending | success | invited | skipped | manual | failed | revoked
      detail        TEXT,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- 工人尚未送出的表單草稿；以 google email 為鍵，跨裝置接續填寫。送出成功後刪除。
    CREATE TABLE IF NOT EXISTS reg_drafts (
      identity_key TEXT PRIMARY KEY, -- google email
      answers_json TEXT NOT NULL DEFAULT '{}',
      updated_ms   INTEGER NOT NULL DEFAULT 0 -- 伺服器收到草稿的 epoch 毫秒，前端據此判斷新舊
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      actor         TEXT NOT NULL,
      action        TEXT NOT NULL,
      submission_id INTEGER,
      meta_json     TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 舊 DB 升級：補上後來新增的欄位
  ensureColumn('submissions', 'telegram_id', 'TEXT');
  ensureColumn('submissions', 'telegram_username', 'TEXT');
  ensureColumn('fields', 'allow_other', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('fields', 'section_id', 'INTEGER');
  ensureColumn('fields', 'option_jumps_json', 'TEXT');
  ensureColumn('fields', 'content', 'TEXT');
  ensureColumn('fields', 'image_path', 'TEXT');
  ensureColumn('fields', 'worker_editable', 'INTEGER NOT NULL DEFAULT 0'); // 允許工人事後透過修改連結編輯
  ensureColumn('submissions', 'edit_token', 'TEXT'); // 工人修改連結的密鑰

  // 回填既有登錄的 edit_token（讓舊資料也能產生修改連結）
  const needToken = db
    .prepare("SELECT id FROM submissions WHERE edit_token IS NULL OR edit_token = ''")
    .all() as { id: number }[];
  if (needToken.length) {
    const upd = db.prepare('UPDATE submissions SET edit_token = ? WHERE id = ?');
    const tx = db.transaction(() => {
      for (const r of needToken) upd.run(randomBytes(24).toString('base64url'), r.id);
    });
    tx();
  }

  // 確保至少有一個區塊，且所有欄位都有所屬區塊
  const secCount = (db.prepare('SELECT count(*) AS c FROM sections').get() as { c: number }).c;
  if (secCount === 0) {
    db.prepare("INSERT INTO sections (title, position) VALUES ('第一部分', 1)").run();
  }
  const firstSection = db.prepare('SELECT id FROM sections ORDER BY position, id LIMIT 1').get() as {
    id: number;
  };
  db.prepare('UPDATE fields SET section_id = ? WHERE section_id IS NULL').run(firstSection.id);
}

function ensureColumn(table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
