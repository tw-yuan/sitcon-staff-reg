# SITCON 2027 工人登錄系統 — 設定教學

這份教學帶你把後台「系統設定」每一個欄位填好。每一節都寫清楚：**用途 → 去哪拿（步驟）→ 填到哪個欄位 → 怎麼驗證**。

你這套部署的固定值（後面會一直用到）：

| 項目 | 值 |
|---|---|
| 對外網域 (Base URL) | `https://sitcon-reg.yuan-tw.net` |
| Google callback | `https://sitcon-reg.yuan-tw.net/auth/google/callback` |
| GitHub callback | `https://sitcon-reg.yuan-tw.net/auth/github/callback` |
| GitLab callback | `https://sitcon-reg.yuan-tw.net/auth/gitlab/callback` |
| Telegram 網域 (setdomain) | `sitcon-reg.yuan-tw.net` |

> 這些在設定頁的各區塊也會自動顯示、可點擊複製。

---

## 0. 開始之前：登入後台

1. 開瀏覽器到 `https://sitcon-reg.yuan-tw.net/admin/login`。
2. 第一次沒有 admin，用「**設定金鑰登入**」。金鑰在伺服器啟動 log：
   ```bash
   docker logs sitcon-staff-reg-app-1 | grep "setup key"
   ```
3. 登入後進「**系統設定**」開始填。
4. **重要操作習慣**：
   - 祕密欄位（Secret/Token/密碼）平常顯示空白＋「已設定（留空不變更）」，**要改就直接重打**，留空代表沿用舊值。
   - 按任何「**測試**」按鈕會**先自動儲存整張表單再測試**，所以「打完就按測試」即可，不用另外找儲存鍵。
   - 全部填完別忘了最後按一次「**儲存設定**」。

---

## 1. 基本

| 欄位 | 說明 |
|---|---|
| **Base URL** | 已預設 `https://sitcon-reg.yuan-tw.net`。除非換網域，否則不用動。 |
| **Admin Email allowlist** | 可以進後台的行政組 **Google 帳號**，逗號分隔，例如 `yuan@ncse.tw, someone@sitcon.org`。設好之後就能改用 Google 登入（見第 2 節），不必再用設定金鑰。 |
| **單檔上傳上限 (MB)** | 工人表單裡「檔案上傳」欄位的單檔大小上限，預設 10。 |

---

## 2. Google 登入（工人 Email + admin 登入）

**用途**：工人用 Google 登入自動帶入 email；行政組也用 Google 登入後台。

**去哪拿**：Google Cloud Console 的 OAuth Client ID。

1. 到 <https://console.cloud.google.com>，建立或選一個專案（例如 `sitcon-reg`）。
2. 左側 **APIs & Services → OAuth consent screen**（OAuth 同意畫面）：
   - 若你有 Google Workspace（ncse.tw），選 **Internal** 最省事（不用送審、限自家網域帳號）。
   - 填 App name、support email；Authorized domains 加 `yuan-tw.net`。
   - Scopes 加 `openid`、`email`、`profile`。
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**：
   - Application type：**Web application**。
   - **Authorized redirect URIs** 新增：`https://sitcon-reg.yuan-tw.net/auth/google/callback`（一定要一字不差）。
   - 建立後會給你 **Client ID** 與 **Client Secret**。

**填哪裡**：設定頁「Google 登入」→ `Google Client ID`、`Google Client Secret`。

**驗證**：儲存後，登出再從 `/admin/login` 點「使用 Google 登入」，用 allowlist 內的帳號應能進後台。

---

## 3. GitHub（僅蒐集帳號）

**用途**：工人用 GitHub 登入，把已驗證的 GitHub 帳號寫進 Sheet（**不開通任何 GitHub 權限**）。

**去哪拿**：GitHub OAuth App。

1. 到 <https://github.com/settings/developers> → **OAuth Apps → New OAuth App**。
2. 填：
   - Application name：`SITCON 2027 工人登錄`
   - Homepage URL：`https://sitcon-reg.yuan-tw.net`
   - **Authorization callback URL**：`https://sitcon-reg.yuan-tw.net/auth/github/callback`
3. 建立後拿到 **Client ID**；再按 **Generate a new client secret** 拿 **Client Secret**。

**填哪裡**：設定頁「GitHub」→ `OAuth Client ID`、`OAuth Client Secret`。

---

## 4. GitLab（登入 + 授權 project developer）

GitLab 有兩個東西要拿：**OAuth 應用程式**（登入用）＋ **Access Token**（開通權限用）。

### 4-1. OAuth 應用程式（登入）
1. 到 gitlab.com → 右上頭像 → **Edit profile / Preferences → Applications**（`https://gitlab.com/-/user_settings/applications`）。
2. 填：
   - Name：`SITCON 2027 工人登錄`
   - **Redirect URI**：`https://sitcon-reg.yuan-tw.net/auth/gitlab/callback`
   - Confidential：勾選
   - Scopes：只勾 **`read_user`**
3. 儲存拿到 **Application ID** 與 **Secret**。

**填哪裡**：設定頁「GitLab」→ `OAuth Application ID`、`OAuth Secret`。
`Base URL` 留空即可（預設 `https://gitlab.com`）。

### 4-2. Access Token（把工人加進 project 當 developer）
1. gitlab.com → **Preferences → Access Tokens**（`https://gitlab.com/-/user_settings/personal_access_tokens`）。
2. 建一個 Personal Access Token，**scope 勾 `api`**。
3. **注意**：這個 token 的擁有者必須對「你要加人的那些 project」有 **Maintainer 或以上** 權限，否則加不了成員。

**填哪裡**：設定頁「GitLab」→ `Owner/Maintainer Token（provisioning 用）`。

**驗證**：填完按「**測試 GitLab token**」，成功會顯示 `✓ token 有效（你的帳號）`。

---

## 5. Telegram（第四個驗證帳號）

**用途**：工人用 Telegram Login 連結帳號（只蒐集，不加群）。

**去哪拿**：Telegram 的 @BotFather。

1. 在 Telegram 搜尋 **@BotFather** 開始對話。
2. 送 `/newbot` → 依指示取 **顯示名稱** 與 **username**（username 必須以 `bot` 結尾，例如 `sitcon_2027_staff_admin_bot`）。
3. BotFather 會給你一段 **token**，長這樣：`8123456789:AAH9x....`（**數字 + 一個冒號 + 一長串**，約 46 字元）。
4. **一定要再做這步**：送 `/setdomain` → 選你的 bot → 輸入 `sitcon-reg.yuan-tw.net`。
   （沒設網域，登入 widget 會出現但 Telegram 會擋掉授權。）

**填哪裡**：設定頁「Telegram」→
- `Bot username（不含 @）`：例如 `sitcon_2027_staff_admin_bot`
- `Bot Token`：**貼那段 `數字:hash`**（⚠️ 不要把 username 貼到這裡！）

**驗證**：按「**測試 Bot token**」，成功會顯示 `✓ Bot 有效：@你的bot`。
> 若顯示 `Not Found` → token 格式錯（八成貼成 username）；`Unauthorized` → token 是錯的/被撤銷。

---

## 6. Google Service Account（Sheets / Drive / Groups 共用一把金鑰）

Sheets 寫入、Drive 上傳與分享、Google Groups 加人，**都用同一個 service account**。先建好它。

1. Google Cloud Console（跟第 2 節同一個專案）→ **APIs & Services → Enabled APIs & services → + ENABLE APIS**，啟用這三個：
   - **Google Sheets API**
   - **Google Drive API**
   - **Admin SDK API**（Google Groups 用）
2. **IAM & Admin → Service Accounts → Create service account**：
   - 取名例如 `sitcon-reg-bot`，建立即可（不用給專案角色）。
3. 點進該 service account → **Keys → Add key → Create new key → JSON** → 下載一個 `.json`。
4. 記下這個 service account 的 **email**（長得像 `sitcon-reg-bot@專案.iam.gserviceaccount.com`）與 **Unique ID / Client ID**（一串數字，第 8 節會用）。

**填哪裡**：設定頁「Google Sheets / Drive」→ `Service Account 金鑰 JSON` → **把整份 JSON 內容貼進去**。

---

## 7. Google Sheets / Drive

### 7-1. 回應試算表（工人資料落地）
1. 建一個 Google Sheet。
2. 在試算表裡建立一個分頁，名稱就叫 **`Responses`**（或你自訂，記得跟下面「分頁名稱」一致）。
3. 把試算表 **分享給第 6 節的 service account email，權限「編輯者」**。
4. 從網址取 **Spreadsheet ID**：
   `https://docs.google.com/spreadsheets/d/`**`這一段就是 ID`**`/edit`

**填哪裡**：
- `回應試算表 ID` → 上面那段 ID
- `分頁名稱` → `Responses`（或你自訂的）

### 7-2. 檔案上傳資料夾
1. 建一個 Google Drive 資料夾。
2. **分享給 service account email，權限「編輯者」**。
3. 從網址取 **Folder ID**：
   `https://drive.google.com/drive/folders/`**`這一段就是 ID`**

**填哪裡**：`檔案上傳資料夾 ID` → 上面那段 ID。

**驗證**：按「**測試試算表**」「**測試上傳資料夾**」，成功會顯示可存取的名稱。
> 常見錯誤：`caller does not have permission` → 忘了把試算表/資料夾分享給 service account；`Unable to parse range` → 分頁名稱打錯或分頁不存在。

---

## 8. Google Groups（Workspace domain-wide delegation）

**用途**：核准後把工人加進指定 Google Group（撤銷時移出）。這需要讓 service account 能「代表管理員」操作 Directory API。

1. 拿到第 6 節 service account 的 **Client ID（一串數字）**。
2. 到 **Google Workspace 管理控制台**（<https://admin.google.com>，需 Workspace 管理員）→ **Security → Access and data control → API controls → Domain-wide delegation → Manage domain-wide delegation → Add new**：
   - **Client ID**：貼上 service account 的數字 Client ID
   - **OAuth scopes**（逗號分隔）：
     ```
     https://www.googleapis.com/auth/admin.directory.group.member,https://www.googleapis.com/auth/admin.directory.user.readonly
     ```
   - Authorize 儲存。
3. 決定一個「**要模擬的 Workspace 管理員信箱**」——一個有權管理群組成員的管理員帳號（例如 `yuan@ncse.tw`）。service account 會以這個身分去加/移除成員。

**填哪裡**：設定頁「Google Groups（Workspace）」→ `要模擬的 Workspace 管理員信箱`。

**驗證**：按「**測試 Google Groups 授權**」，成功會顯示 `✓ domain-wide delegation 正常（可模擬 …）`。
> 失敗常見 `unauthorized_client` → delegation 的 Client ID 或 scopes 沒設對；請確認 Admin SDK API 已啟用、scopes 一字不差。

---

## 9. Email (SMTP)

**用途**：寄「已收到登錄」「權限已開通」「退回」通知信。

以你目前用的 **Google Workspace SMTP relay** 為例：

1. （若還沒開）Google Workspace 管理控制台 → **Apps → Google Workspace → Gmail → Routing → SMTP relay service** 開一條，設定允許寄件者與要求 TLS / SMTP AUTH。
2. 設定頁「Email (SMTP)」填：
   | 欄位 | 值 |
   |---|---|
   | SMTP Host | `smtp-relay.gmail.com` |
   | Port | **`587`** |
   | 使用 TLS (true/false) | **`false`**（587 走 STARTTLS）|
   | 帳號 | 你的 Workspace 帳號，例如 `yuan@ncse.tw` |
   | 密碼 | 見下方 App Password |
   | 寄件人 | `SITCON 2027 行政組 <sitcon-reg@ncse.tw>`（寄件網域要在 relay 允許範圍內）|

   > **secure 與 port 一定要配對**：`587 → false`（STARTTLS）或 `465 → true`（直接 TLS）。配錯就會噴 `wrong version number`。

3. **App Password**（帳號有兩步驟驗證時必須用）：
   - Google 帳號 → **Security → 2-Step Verification → App passwords** 產生一組 16 碼密碼，填到「密碼」欄（不是你平常登入的密碼）。

**驗證**：
- 按「**測試 SMTP 連線**」→ `✓ SMTP 連線成功`。
- 在「收件信箱」填自己的信箱 → 按「**寄測試信**」→ 去收信匣確認收到。

---

## 10. 工作組與權限範本（後台「工作組」頁）

每個工作組設定「核准後要自動開通哪些權限」。到後台 **工作組** 頁，先建工作組，再對每個工作組新增權限項目：

| 平台 | target（目標）怎麼填 | role（角色） |
|---|---|---|
| **Google Drive** | 資料夾 ID（同第 7-2 取法；service account 需對該資料夾有可分享的編輯權，建議放在 Shared Drive 並讓 SA 當 Manager） | `writer`（＝協作者）、或 `reader`、`commenter` |
| **Google Groups** | 群組 email，例如 `agenda-2027@sitcon.org`（群組要先存在） | `MEMBER`（或 `MANAGER`、`OWNER`）|
| **GitLab** | project 的 path，例如 `sitcon/2027/website`；或加 `group:` 前綴改成整個 group，例如 `group:sitcon/2027` | `developer`（或 guest/reporter/maintainer/owner）|

工人登錄時會自己選「所屬工作組」；行政組核准時可再調整。核准後系統就依該工作組的範本自動開通，並可在該筆的詳情頁「撤銷」。

---

## 11. 常見錯誤排查

| 症狀 | 原因 / 解法 |
|---|---|
| 容器一直重啟、log 出現 `SQLITE_CANTOPEN` | `./data` 權限。host 執行 `sudo chown -R 1000:1000 data secrets` 再 `docker compose up -d`。 |
| Telegram 測試 `Not Found` | token 貼成 username 了。貼真正的 `數字:hash` token。 |
| Telegram 測試 `Unauthorized` | token 錯或已撤銷，重新從 BotFather 拿。 |
| Telegram widget 可按但授權失敗 | 忘了在 BotFather `/setdomain` 設 `sitcon-reg.yuan-tw.net`。 |
| SMTP 測試 `wrong version number` | secure/port 配錯。用 `587+false` 或 `465+true`。 |
| SMTP 登入失敗 | 帳號有兩步驟驗證，要改用 **App Password**。 |
| OAuth 登入 `redirect_uri_mismatch` | 平台上填的 callback 與 `附錄` 不一致（含 http/https、結尾斜線）。 |
| Google Sheet/Drive `caller does not have permission` | 忘了把試算表/資料夾分享給 service account email。 |
| Google Sheet `Unable to parse range` | 分頁名稱打錯或分頁還沒建立。 |
| Google Groups `unauthorized_client` | domain-wide delegation 的 Client ID / scopes 沒設對，或 Admin SDK API 沒啟用。 |

---

## 附錄：一次看完要準備的東西

- [ ] Google OAuth：Client ID + Secret（callback `…/auth/google/callback`）
- [ ] GitHub OAuth：Client ID + Secret（callback `…/auth/github/callback`）
- [ ] GitLab OAuth：Application ID + Secret（callback `…/auth/gitlab/callback`，scope `read_user`）
- [ ] GitLab Token：PAT scope `api`，擁有者對目標 project 有 Maintainer+
- [ ] Telegram：Bot username + Bot Token，並 `/setdomain`
- [ ] Google Service Account：啟用 Sheets/Drive/Admin SDK API，下載 JSON
- [ ] 回應試算表 ID（建 `Responses` 分頁、分享給 SA）
- [ ] 上傳資料夾 ID（分享給 SA）
- [ ] Google Groups：SA 的 Client ID 做 domain-wide delegation（兩個 scope）＋ 要模擬的管理員信箱
- [ ] SMTP：host/port/secure/帳號/App Password/寄件人
- [ ] Admin allowlist：行政組 Google 帳號
- [ ] 各工作組的權限範本（Drive 資料夾 / Group email / GitLab project）
