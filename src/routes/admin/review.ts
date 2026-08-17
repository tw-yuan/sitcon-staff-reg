import { Router } from 'express';
import { takeFlash } from '../../auth/session';
import {
  STATUS_LABELS,
  deleteSubmission,
  getSubmission,
  setSheetRow,
  setStatus,
  setWorkgroup,
  updateAnswers,
} from '../../models/submissions';
import { listFields } from '../../models/fields';
import {
  getDefaultWorkgroupId,
  getWorkGroup,
  listWorkGroups,
  PLATFORM_LABELS,
} from '../../models/workgroups';
import { PROV_STATUS_LABELS, listTasks } from '../../models/provisioning';
import { listAudit, logAudit } from '../../models/audit';
import {
  grantedSummaryLines,
  retryTask,
  revokeAll,
  revokeTask,
  runProvisioning,
  seedTasks,
} from '../../services/provisioning';
import { updateSubmissionRow, upsertSubmissionRow } from '../../services/sheets';
import { sendApprovedMail, sendRejectedMail } from '../../services/mailer';
import { notifyAnswersUpdated } from '../../services/telegramNotify';

export const reviewRouter = Router();

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (v === undefined || v === null || v === '') return [];
  return [String(v)];
}

async function syncSheet(id: number): Promise<void> {
  try {
    await updateSubmissionRow(getSubmission(id)!);
  } catch (err) {
    console.error('[sheets] 更新失敗', err);
  }
}

reviewRouter.get('/:id', (req, res) => {
  const sub = getSubmission(Number(req.params.id));
  if (!sub) {
    res.status(404).render('error', { title: '找不到', message: '查無此登錄' });
    return;
  }
  // 下拉預選：該筆已指定過工作組就用它，否則帶入預設工作組（可再手動改）。
  const presetWorkgroupId = sub.workgroupId != null ? sub.workgroupId : getDefaultWorkgroupId();
  res.render('admin/submission', {
    sub,
    fields: listFields(),
    workgroups: listWorkGroups(),
    presetWorkgroupId,
    workgroupName: sub.workgroupId ? getWorkGroup(sub.workgroupId)?.name || '' : '',
    tasks: listTasks(sub.id),
    audit: listAudit(sub.id),
    statusLabels: STATUS_LABELS,
    provStatusLabels: PROV_STATUS_LABELS,
    platformLabels: PLATFORM_LABELS,
    flash: takeFlash(req),
  });
});

reviewRouter.post('/:id/workgroup', (req, res) => {
  const id = Number(req.params.id);
  const wgRaw = String(req.body.workgroup_id || '').trim();
  const wg = wgRaw ? getWorkGroup(Number(wgRaw)) : undefined;
  setWorkgroup(id, wg ? wg.id : null);
  logAudit(req.session.admin!.email, 'workgroup_assigned', id, { workgroup: wg?.name || null });
  req.session.flash = '已更新工作組';
  res.redirect(`/admin/submissions/${id}`);
});

reviewRouter.post('/:id/approve', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sub = getSubmission(id);
    if (!sub) {
      res.status(404).render('error', { title: '找不到', message: '查無此登錄' });
      return;
    }
    const doProvision = req.body.provision === 'on' || req.body.provision === 'true';
    const wgRaw = String(req.body.workgroup_id || '').trim();
    if (wgRaw) {
      const wg = getWorkGroup(Number(wgRaw));
      if (wg) setWorkgroup(id, wg.id);
    }
    setStatus(id, 'approved', req.session.admin!.email);
    const fresh = getSubmission(id)!;
    seedTasks(id, fresh.workgroupId); // 建立 pending 任務（不論是否立即開通，之後都可開通）

    if (doProvision) {
      const tasks = await runProvisioning(id);
      await syncSheet(id);
      void sendApprovedMail(getSubmission(id)!, grantedSummaryLines(tasks));
      const failed = tasks.filter((t) => t.status === 'failed').length;
      const manual = tasks.filter((t) => t.status === 'manual').length;
      const manualNote = manual ? `（另有 ${manual} 項需手動處理，見下方）` : '';
      req.session.flash = failed
        ? `已核准，但有 ${failed} 項授權失敗，請於下方重試${manualNote}`
        : `已核准並完成權限開通${manualNote}`;
      logAudit(req.session.admin!.email, 'approved', id, { provision: true, failed, manual });
    } else {
      await syncSheet(id);
      req.session.flash = '已核准（未開通權限；可稍後於下方「重跑全部未完成」開通）';
      logAudit(req.session.admin!.email, 'approved', id, { provision: false });
    }
    res.redirect(`/admin/submissions/${id}`);
  } catch (err) {
    next(err);
  }
});

reviewRouter.post('/:id/reject', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!getSubmission(id)) {
      res.status(404).render('error', { title: '找不到', message: '查無此登錄' });
      return;
    }
    const reason = String(req.body.reason || '').trim();
    setStatus(id, 'rejected', req.session.admin!.email, reason);
    await syncSheet(id);
    void sendRejectedMail(getSubmission(id)!, reason);
    logAudit(req.session.admin!.email, 'rejected', id, { reason });
    req.session.flash = '已退回並通知工人';
    res.redirect(`/admin/submissions/${id}`);
  } catch (err) {
    next(err);
  }
});

reviewRouter.post('/:id/reprovision', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await runProvisioning(id);
    await syncSheet(id);
    logAudit(req.session.admin!.email, 'reprovision', id, {});
    req.session.flash = '已重跑權限開通';
    res.redirect(`/admin/submissions/${id}`);
  } catch (err) {
    next(err);
  }
});

reviewRouter.post('/tasks/:taskId/retry', async (req, res, next) => {
  try {
    const task = await retryTask(Number(req.params.taskId));
    if (!task) {
      res.redirect('/admin');
      return;
    }
    logAudit(req.session.admin!.email, 'task_retry', task.submissionId, {
      platform: task.platform,
      status: task.status,
    });
    req.session.flash = `已重試 ${task.platform}：${task.status}`;
    res.redirect(`/admin/submissions/${task.submissionId}`);
  } catch (err) {
    next(err);
  }
});

reviewRouter.post('/tasks/:taskId/revoke', async (req, res, next) => {
  try {
    const task = await revokeTask(Number(req.params.taskId));
    if (!task) {
      res.redirect('/admin');
      return;
    }
    logAudit(req.session.admin!.email, 'task_revoke', task.submissionId, {
      platform: task.platform,
      status: task.status,
    });
    req.session.flash = `已撤銷 ${task.platform}：${task.status}`;
    res.redirect(`/admin/submissions/${task.submissionId}`);
  } catch (err) {
    next(err);
  }
});

reviewRouter.post('/:id/revoke-selected', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!getSubmission(id)) {
      res.status(404).render('error', { title: '找不到', message: '查無此登錄' });
      return;
    }
    const raw = (req.body as { task_ids?: unknown }).task_ids;
    const ids = (Array.isArray(raw) ? raw : raw != null ? [raw] : []).map(Number).filter(Boolean);
    const own = new Set(listTasks(id).map((t) => t.id)); // 只允許撤銷本筆的任務
    let n = 0;
    for (const tid of ids) {
      if (own.has(tid)) {
        await revokeTask(tid);
        n++;
      }
    }
    await syncSheet(id);
    logAudit(req.session.admin!.email, 'revoke_selected', id, { count: n });
    req.session.flash = n ? `已撤銷 ${n} 項權限` : '未選取任何項目';
    res.redirect(`/admin/submissions/${id}`);
  } catch (err) {
    next(err);
  }
});

reviewRouter.post('/:id/revoke-all', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!getSubmission(id)) {
      res.status(404).render('error', { title: '找不到', message: '查無此登錄' });
      return;
    }
    const tasks = await revokeAll(id);
    await syncSheet(id);
    logAudit(req.session.admin!.email, 'revoke_all', id, {
      failed: tasks.filter((t) => t.status === 'failed').length,
    });
    req.session.flash = '已撤銷該工人所有已開通的權限';
    res.redirect(`/admin/submissions/${id}`);
  } catch (err) {
    next(err);
  }
});

// US-13：admin 手動編輯工人的手填欄位（檔案欄位不在此處理）
reviewRouter.post('/:id/answers', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sub = getSubmission(id);
    if (!sub) {
      res.status(404).render('error', { title: '找不到', message: '查無此登錄' });
      return;
    }
    const fields = listFields();
    const answers = { ...sub.answers };
    for (const f of fields) {
      if (f.type === 'file') continue;
      if (f.type === 'multi_select') {
        if (req.body[f.key] !== undefined) answers[f.key] = asArray(req.body[f.key]);
      } else if (req.body[f.key] !== undefined) {
        answers[f.key] = String(req.body[f.key]);
      }
    }
    // 與工人自行修改相同：比對新舊答案找出實際變動的欄位，發 Telegram 通知
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const changedFields = fields.filter((f) => !same(sub.answers[f.key], answers[f.key]));
    updateAnswers(id, answers);
    await syncSheet(id);
    logAudit(req.session.admin!.email, 'answers_edited', id, {});
    void notifyAnswersUpdated(getSubmission(id)!, changedFields.map((f) => f.label));
    req.session.flash = '已更新工人資料';
    res.redirect(`/admin/submissions/${id}`);
  } catch (err) {
    next(err);
  }
});

// 手動把這筆登錄 upsert 進 Google Sheet（有列就更新、沒列就新增）。
// 這是給「工人送出時寫入失敗」補寫用的；失敗會把真正的錯誤（如權限不足）顯示在後台。
reviewRouter.post('/:id/sheet-upsert', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sub = getSubmission(id);
    if (!sub) {
      res.status(404).render('error', { title: '找不到', message: '查無此登錄' });
      return;
    }
    const { row, mode } = await upsertSubmissionRow(sub);
    if (row) setSheetRow(id, row); // 同步本地 sheet_row 到 Sheet 實際列（含以 email 對上的既有列）
    logAudit(req.session.admin!.email, 'sheet_upsert', id, { mode, row });
    req.session.flash =
      mode === 'appended'
        ? `已寫入 Google Sheet（新增第 ${row} 列）`
        : `已更新 Google Sheet 第 ${row} 列（以 Email 對上既有列）`;
    res.redirect(`/admin/submissions/${id}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logAudit(req.session.admin!.email, 'sheet_upsert_failed', Number(req.params.id), { error: msg });
    req.session.flash = `寫入 Google Sheet 失敗：${msg}`;
    res.redirect(`/admin/submissions/${req.params.id}`);
  }
});

// 從本地資料庫刪除整筆登錄（provisioning 任務連帶刪除；不會動 Google Sheet／不撤銷已開通權限）。
// 刪除後該 email 可重新登錄。稽核紀錄保留（含此刪除事件與被刪者身分）。
reviewRouter.post('/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  const sub = getSubmission(id);
  if (!sub) {
    res.status(404).render('error', { title: '找不到', message: '查無此登錄' });
    return;
  }
  const activeGrants = listTasks(id).filter(
    (t) => t.status === 'success' || t.status === 'invited',
  ).length;
  // 先記稽核（保留被刪者身分），再刪除本體。
  logAudit(req.session.admin!.email, 'submission_deleted', id, {
    email: sub.googleEmail,
    status: sub.status,
    activeGrants,
  });
  deleteSubmission(id);
  req.session.flash =
    `已刪除 ${sub.googleEmail || `#${id}`} 的本地登錄紀錄，該帳號可重新登錄。` +
    (activeGrants
      ? `⚠️ 此工人仍有 ${activeGrants} 項已開通的權限未撤銷，且 Google Sheet 的資料列不會自動移除，請自行處理。`
      : ' 注意：Google Sheet 的資料列不會自動移除。');
  res.redirect('/admin');
});
