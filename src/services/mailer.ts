import nodemailer, { Transporter } from 'nodemailer';
import { config, featureReady } from '../config';
import { Submission } from '../models/submissions';
import { getSetting } from '../models/settings';
import { getWorkGroup } from '../models/workgroups';
import { listWorkerEditableFields } from '../models/fields';

let transporter: Transporter | null = null;

/**
 * EHLO/HELO 要送出的主機名。容器預設是 os.hostname()＝容器 ID（非 FQDN），
 * 某些郵件伺服器（如 Google Workspace SMTP relay）會在 EHLO 階段以
 * `421-4.7.0 ... closing connection (EHLO)` 拒絕。改用 Base URL 的網域當 FQDN。
 */
export function smtpEhloName(): string {
  try {
    const h = new URL(config.baseUrl).hostname;
    if (h && h.includes('.')) return h;
  } catch {
    /* ignore */
  }
  return 'localhost';
}

// 每次依當下設定建立（避免快取到舊 SMTP 設定；連線建立成本低）。
function getTransporter(): Transporter {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    name: smtpEhloName(),
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transporter;
}

/** 寄信；未設定 SMTP 時記錄並略過（不讓主流程失敗）。 */
export async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  if (!featureReady.smtp()) {
    console.warn(`[mailer] SMTP 未設定，略過寄信給 ${to}：${subject}`);
    return false;
  }
  if (!to) return false;
  try {
    await getTransporter().sendMail({
      from: config.smtp.from,
      to,
      subject,
      html,
      replyTo: config.smtp.replyTo || undefined,
    });
    return true;
  } catch (err) {
    console.error('[mailer] 寄信失敗', err);
    return false;
  }
}

/** 內文外框：提供字體與頁尾；主旨與內文由模板控制。 */
function wrap(bodyHtml: string): string {
  return `<div style="font-family:sans-serif;line-height:1.6">${bodyHtml}
    <hr><p style="color:#888;font-size:12px">SITCON 2027 行政組</p></div>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 以 {{key}} 代入變數；未提供的佔位符保持原樣。 */
function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** 信件模板定義：主旨與內文（HTML）皆可於後台編輯，未設定則用此預設值。 */
export interface MailTemplateMeta {
  subjectKey: string;
  bodyKey: string;
  label: string;
  vars: string[]; // 可用變數（顯示於後台提示）
  subject: string; // 預設主旨
  body: string; // 預設內文（HTML）
}

export const MAIL_TEMPLATES: Record<'received' | 'approved' | 'rejected', MailTemplateMeta> = {
  received: {
    subjectKey: 'mail_received_subject',
    bodyKey: 'mail_received_body',
    label: '收到登錄（寄給工人）',
    vars: ['{{email}}', '{{workgroup}}', '{{editLink}}'],
    subject: '【SITCON 2027】已收到你的工人登錄',
    body:
      '<h2>已收到你的工人登錄 🎉</h2>' +
      '<p>我們已收到你的登錄資料（{{email}}），狀態為「待審核」。</p>' +
      '<p>行政組審核並開通權限後會再寄一封通知信給你。</p>',
  },
  approved: {
    subjectKey: 'mail_approved_subject',
    bodyKey: 'mail_approved_body',
    label: '審核通過（寄給工人）',
    vars: ['{{email}}', '{{workgroup}}', '{{grantedList}}', '{{editLink}}'],
    subject: '【SITCON 2027】你的權限已開通',
    body:
      '<h2>你的權限已開通 ✅</h2>' +
      '<p>你的工人登錄已通過審核，以下權限已為你開通：</p>' +
      '{{grantedList}}' +
      '<p>部分平台（如 GitHub）可能需要你自行接受邀請信才會生效，請留意。</p>',
  },
  rejected: {
    subjectKey: 'mail_rejected_subject',
    bodyKey: 'mail_rejected_body',
    label: '審核退回（寄給工人）',
    vars: ['{{email}}', '{{workgroup}}', '{{reason}}'],
    subject: '【SITCON 2027】你的工人登錄需要修正',
    body:
      '<h2>你的工人登錄被退回</h2>' +
      '<p>你的登錄資料需要修正。</p>' +
      '{{reason}}' +
      '<p>請聯絡行政組協助處理。</p>',
  },
};

function workgroupName(sub: Submission): string {
  return sub.workgroupId ? getWorkGroup(sub.workgroupId)?.name || '' : '';
}

/** 該筆登錄的工人修改連結；無 token 時回空字串。 */
function editLinkFor(sub: Submission): string {
  if (!sub.editToken) return '';
  return `${config.baseUrl.replace(/\/+$/, '')}/edit/${sub.editToken}`;
}

function editLinkAnchor(url: string): string {
  return `<a href="${esc(url)}">${esc(url)}</a>`;
}

/**
 * 依模板寄信：主旨以純文字變數代入，內文以 HTML 變數代入（外層再包 wrap）。
 * htmlVars 中的值須為「已可安全放入 HTML」的字串。
 * 傳入 editLinkUrl 時：提供 {{editLink}} 變數；若模板沒放該 placeholder 且目前有開放修改的欄位，
 * 則自動在內文尾端補上一行修改連結（讓既有自訂模板也能拿到連結）。
 */
function sendTemplate(
  sub: Submission,
  meta: MailTemplateMeta,
  rawVars: Record<string, string>,
  htmlVars: Record<string, string>,
  editLinkUrl?: string,
): Promise<boolean> {
  const subject = render(getSetting(meta.subjectKey) || meta.subject, rawVars);
  const rawBody = getSetting(meta.bodyKey) || meta.body;
  // 只有「確實有開放給工人修改的欄位」時才提供修改連結，避免信中出現連到空白編輯頁的連結。
  const activeUrl = editLinkUrl && listWorkerEditableFields().length > 0 ? editLinkUrl : '';
  const vars = { ...htmlVars };
  if (editLinkUrl !== undefined) vars.editLink = activeUrl ? editLinkAnchor(activeUrl) : '';
  let body = render(rawBody, vars);
  if (activeUrl && !rawBody.includes('{{editLink}}')) {
    body += `<p>修改偏好（如室友、工人福利等）請點這個連結：${editLinkAnchor(activeUrl)}</p>`;
  }
  return sendMail(sub.googleEmail, subject, wrap(body));
}

export function sendReceivedMail(sub: Submission): Promise<boolean> {
  const email = sub.googleEmail;
  const wg = workgroupName(sub);
  return sendTemplate(
    sub,
    MAIL_TEMPLATES.received,
    { email, workgroup: wg },
    { email: esc(email), workgroup: esc(wg) },
    editLinkFor(sub),
  );
}

export function sendApprovedMail(sub: Submission, grantedLines: string[]): Promise<boolean> {
  const list = grantedLines.length
    ? `<ul>${grantedLines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
    : '<p>（本次未設定需開通的權限）</p>';
  const email = sub.googleEmail;
  const wg = workgroupName(sub);
  return sendTemplate(
    sub,
    MAIL_TEMPLATES.approved,
    { email, workgroup: wg },
    { email: esc(email), workgroup: esc(wg), grantedList: list },
    editLinkFor(sub),
  );
}

export function sendRejectedMail(sub: Submission, reason: string): Promise<boolean> {
  const reasonHtml = reason ? `<p>原因：${esc(reason)}</p>` : '';
  const email = sub.googleEmail;
  const wg = workgroupName(sub);
  return sendTemplate(
    sub,
    MAIL_TEMPLATES.rejected,
    { email, workgroup: wg },
    { email: esc(email), workgroup: esc(wg), reason: reasonHtml },
  );
}
