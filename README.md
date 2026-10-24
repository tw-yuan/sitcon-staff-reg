# SITCON 2027 工人登錄系統

工人以 **GitHub / GitLab / Google OAuth + Telegram Login** 登入，系統自動帶入已驗證的帳號（消除「大手指」打錯），像 **Google 表單**一樣填寫其餘欄位並送出；行政組於 **admin dashboard** 審核，核准後**自動**替工人開通 **Google Drive（資料夾協作者）/ Google Groups（群組成員）/ GitLab（project developer）** 權限，且可**撤銷**。工人回應資料落地於 **Google Sheet**。GitHub 僅蒐集帳號、不做權限開通。

> Telegram 為第四個「驗證帳號」，僅蒐集帳號（Telegram 平台限制 bot 無法自動把人加進群組），不做自動加群 / provisioning。

完整規格見 `docs/`（或 PM 規格文件）。

## 技術決策

| 項目 | 選擇 | 理由 |
|---|---|---|
| 語言/框架 | Node.js 22+ / TypeScript / Express | 輕量、三平台 API 生態成熟 |
| 前端 | EJS server-rendered + 原生 JS | 無額外前端 build，docker compose 一鍵起 |
| 設定/schema/審核狀態/audit | **SQLite**（docker volume） | 動態表單 schema、工作組、權限範本、狀態需結構化查詢 |
| 工人回應資料 | **Google Sheet** | 行政組直接檢視的正式資料落地 |
| 檔案上傳 | **Google Drive** 指定資料夾 | Sheet 內僅存連結 |
| 非同步授權/寄信 | 送出後同步嘗試 + 失敗可於 dashboard 重試 | 單容器輕量，不引入額外 queue |

## 目錄結構

```
src/
  index.ts          # 進入點
  config.ts         # 讀取環境變數
  db/               # SQLite 初始化 + migration
  models/           # fields / workgroups / submissions / audit
  auth/             # OAuth（Google/GitHub/GitLab）+ admin allowlist + session
  routes/           # 工人登錄 + admin（form builder / workgroups / review）
  services/         # sheets / drive / mailer / provisioning
  validation/       # 欄位驗證（regex/型別/必填）
views/              # EJS 模板
public/             # CSS / JS
```

## 兩種設定方式

**A. 網頁後台設定（推薦，不用碰 .env）**
1. 直接 `docker compose up --build`（`.env` 可留空或不建立）。
2. 看啟動 log 印出的 **setup key**。
3. 到 `/admin/login` → 用「設定金鑰登入」→ 進入「系統設定」，填入 Google 登入、admin 名單、各平台憑證、SMTP、Service Account JSON 等，儲存即生效（存在資料庫）。
4. 設好 Google 登入與 admin 名單後，之後就能直接用 Google 帳號登入後台。

**B. 用 .env**：把設定寫在 `.env`（見 `.env.example`）。兩者可混用，後台設定會覆蓋 env。

## 設定步驟（憑證怎麼申請）

1. **建立 OAuth application**（三個 callback URL 皆為 `${BASE_URL}/auth/<provider>/callback`）：
   - Google Cloud Console → OAuth client（scope: `openid email profile`）。
   - GitHub → Developer settings → OAuth Apps。
   - GitLab（gitlab.com）→ User Settings → Applications（scope: `read_user`）。
   - Telegram：向 `@BotFather` 建立 bot 取得 `TELEGRAM_BOT_TOKEN` 與 bot username，並用 `/setdomain` 把網域設為 `BASE_URL` 的 host（Login Widget 才會運作）。
2. **Google Service Account**：建立 service account、下載 JSON 金鑰放到 `./secrets/service-account.json`；
   - 把「工人回應試算表」與「上傳資料夾」**分享給 service account 的 email**（編輯權限）。
3. **Provisioning 憑證**：
   - GitLab：具 Owner/Maintainer 的 PAT（scope 含 `api`），用來把工人加入 project 成員。
   - Google Groups：為 service account 開 **domain-wide delegation**，授權範圍 `admin.directory.group.member`（測試另需 `admin.directory.user.readonly`），並在設定填一位可管理群組的 **Workspace 管理員信箱**供模擬。
   - Google Drive：service account 需對目標資料夾有編輯權（同 Sheets 那把金鑰）。
4. 複製 `.env.example` 為 `.env` 並填入上述值與 `ADMIN_EMAILS`。

## 執行

```bash
# 本機開發（非 docker）
npm install
npm run dev          # http://localhost:3000（可用 PORT 環境變數改）

# docker compose（.env 可選）
mkdir -p data secrets
sudo chown -R 1000:1000 data secrets   # 容器以非 root(uid 1000) 執行，需能寫入 data
docker compose up --build   # 服務對外在 http://localhost:9000
```

> 若見 `SQLITE_CANTOPEN` / 容器 crash-loop，多半是 `./data` 權限問題——host 的 `data`（與 `secrets`）需可被 uid 1000 讀寫，執行上面的 `chown` 即可。

> docker 下容器內固定監聽 3000，對外埠在 `docker-compose.yml` 的 `ports`（目前 `9000:3000`）。改對外埠只要改這行即可。

- 工人登錄：`http://localhost:9000/`
- Admin dashboard：`http://localhost:9000/admin`（首次用啟動 log 的 setup key 登入）

## 尚待補齊 / 待決策

- Google Drive 授權機制細節（個人資料夾分享 vs Shared Drive 成員；service account 權限）。
- 動態欄位變更後、已有回應時的 Google Sheet 欄位遷移策略。
- 檔案上傳的檔案型別白名單。

> 需要真實 OAuth / API 憑證才能端到端測試 provisioning 與寄信；未設定時系統會以「設定未完成」狀態記錄並可於 dashboard 重試。
