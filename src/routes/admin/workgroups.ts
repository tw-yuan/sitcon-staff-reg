import { Router } from 'express';
import { takeFlash } from '../../auth/session';
import {
  PLATFORMS,
  PLATFORM_LABELS,
  Platform,
  addGrant,
  createWorkGroup,
  deleteGrant,
  deleteWorkGroup,
  getDefaultWorkgroupId,
  getWorkGroup,
  listGrants,
  listWorkGroups,
  renameWorkGroup,
  setDefaultWorkgroupId,
} from '../../models/workgroups';
import { logAudit } from '../../models/audit';

export const workgroupsRouter = Router();

workgroupsRouter.get('/', (req, res) => {
  const groups = listWorkGroups().map((g) => ({ ...g, grants: listGrants(g.id) }));
  res.render('admin/workgroups', {
    groups,
    defaultWorkgroupId: getDefaultWorkgroupId(),
    platforms: PLATFORMS,
    platformLabels: PLATFORM_LABELS,
    flash: takeFlash(req),
  });
});

// 設為預設工作組：審核頁的工作組下拉會預先帶入它（該筆尚未指定過工作組時）。
workgroupsRouter.post('/:id/default', (req, res) => {
  const id = Number(req.params.id);
  const wg = getWorkGroup(id);
  if (!wg) {
    req.session.flash = '查無此工作組';
    res.redirect('/admin/workgroups');
    return;
  }
  setDefaultWorkgroupId(id);
  logAudit(req.session.admin!.email, 'default_workgroup_set', null, { id, name: wg.name });
  req.session.flash = `已將「${wg.name}」設為預設工作組`;
  res.redirect('/admin/workgroups');
});

// 取消預設（審核頁下拉改回預設「不指定工作組」）。
workgroupsRouter.post('/:id/unset-default', (req, res) => {
  setDefaultWorkgroupId(null);
  logAudit(req.session.admin!.email, 'default_workgroup_cleared', null, {});
  req.session.flash = '已取消預設工作組';
  res.redirect('/admin/workgroups');
});

workgroupsRouter.post('/', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) {
    req.session.flash = '工作組名稱必填';
    res.redirect('/admin/workgroups');
    return;
  }
  try {
    createWorkGroup(name);
    logAudit(req.session.admin!.email, 'workgroup_created', null, { name });
    req.session.flash = `已新增工作組「${name}」`;
  } catch {
    req.session.flash = '工作組名稱重複';
  }
  res.redirect('/admin/workgroups');
});

workgroupsRouter.post('/:id/rename', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name) renameWorkGroup(Number(req.params.id), name);
  res.redirect('/admin/workgroups');
});

workgroupsRouter.post('/:id/delete', (req, res) => {
  deleteWorkGroup(Number(req.params.id));
  logAudit(req.session.admin!.email, 'workgroup_deleted', null, { id: req.params.id });
  req.session.flash = '已刪除工作組';
  res.redirect('/admin/workgroups');
});

workgroupsRouter.post('/:id/grants', (req, res) => {
  const workgroupId = Number(req.params.id);
  const platformRaw = String(req.body.platform || '');
  const platform = (PLATFORMS as string[]).includes(platformRaw) ? (platformRaw as Platform) : null;
  const target = String(req.body.target || '').trim();
  const role = String(req.body.role || '').trim();
  const isNote = platform === 'note'; // 自訂通知：target=通知文字、role 不需要
  if (!platform || !target || (!isNote && !role)) {
    req.session.flash = isNote ? '自訂通知文字必填' : '平台 / 目標 / 角色皆必填';
    res.redirect('/admin/workgroups');
    return;
  }
  addGrant(workgroupId, platform, target, isNote ? '' : role);
  logAudit(req.session.admin!.email, 'grant_added', null, { workgroupId, platform, target, role: isNote ? '' : role });
  req.session.flash = isNote ? '已新增自訂通知文字' : '已新增權限項目';
  res.redirect('/admin/workgroups');
});

workgroupsRouter.post('/grants/:grantId/delete', (req, res) => {
  deleteGrant(Number(req.params.grantId));
  res.redirect('/admin/workgroups');
});
