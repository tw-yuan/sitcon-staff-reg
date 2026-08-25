function showResult(out, ok, msg) {
  if (!out) return;
  out.className = 'test-result small ' + (ok ? 'ok-text' : 'err-text');
  out.textContent = (ok ? '✓ ' : '✗ ') + (msg || '');
}

function runTest(out, url) {
  if (out) {
    out.className = 'test-result muted small';
    out.textContent = '測試中…';
  }
  return fetch(url, { method: 'POST' })
    .then(function (r) { return r.json(); })
    .then(function (data) { showResult(out, data.ok, data.message); })
    .catch(function (err) { showResult(out, false, String(err)); });
}

function postForm(action, form) {
  return fetch(action, { method: 'POST', body: new URLSearchParams(new FormData(form)) });
}

// 先把目前設定表單存起來（讓「測試」測到剛填的值），再執行 next()。
function saveThen(out, form, next) {
  if (!form) { next(); return; }
  if (out) { out.className = 'test-result muted small'; out.textContent = '儲存中…'; }
  postForm('/admin/settings', form).then(function () { next(); }).catch(function (err) {
    showResult(out, false, '儲存失敗：' + err);
  });
}

document.addEventListener('click', function (e) {
  var el = e.target;
  if (!el || !el.classList) return;

  if (el.classList.contains('copyable')) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(el.textContent).then(function () {
        var orig = el.textContent;
        el.textContent = '已複製 ✓';
        setTimeout(function () { el.textContent = orig; }, 800);
      });
    }
    return;
  }

  if (el.classList.contains('js-test')) {
    e.preventDefault();
    var bar = el.closest('.test-bar');
    var out = bar ? bar.querySelector('.test-result') : null;
    var url = '/admin/settings/test/' + encodeURIComponent(el.getAttribute('data-test'));
    saveThen(out, el.closest('form'), function () { runTest(out, url); });
    return;
  }

  if (el.classList.contains('js-test-email')) {
    e.preventDefault();
    var bar2 = el.closest('.test-bar');
    var out2 = bar2 ? bar2.querySelector('.test-result') : null;
    var input = bar2 ? bar2.querySelector('.js-test-email-to') : null;
    var to = input ? input.value.trim() : '';
    if (!to) { showResult(out2, false, '請輸入收件信箱'); return; }
    saveThen(out2, el.closest('form'), function () {
      runTest(out2, '/admin/settings/test-email?to=' + encodeURIComponent(to));
    });
    return;
  }
});

// 登入頁：自訂 Telegram 登入按鈕。用官方 Telegram.Login.auth 開登入彈窗，
// 成功後把回傳資料組成 query 導回既有的 /auth/telegram/callback（伺服器驗證流程不變）。
document.addEventListener('click', function (e) {
  var btn = e.target.closest ? e.target.closest('.js-tg-login') : null;
  if (!btn) return;
  e.preventDefault();
  var api = window.Telegram && window.Telegram.Login && window.Telegram.Login.auth;
  if (!api) { alert('Telegram 登入元件尚未載入完成，請稍候再試一次'); return; }
  var botId = btn.getAttribute('data-bot-id');
  if (!botId) { alert('Telegram Bot 尚未設定'); return; }
  btn.disabled = true;
  window.Telegram.Login.auth({ bot_id: botId, request_access: 'write' }, function (data) {
    btn.disabled = false;
    if (!data) return; // 使用者取消或未授權
    var params = new URLSearchParams();
    Object.keys(data).forEach(function (k) { if (data[k] != null) params.set(k, String(data[k])); });
    window.location.href = '/auth/telegram/callback?' + params.toString();
  });
});

// Form Builder：依欄位型別切換「選項」與「regex」區塊的顯示。
document.addEventListener('change', function (e) {
  var target = e.target;
  if (!target || !target.classList || !target.classList.contains('js-type')) return;
  var form = target.closest('form');
  if (!form) return;
  var type = target.value;
  var isChoice = ['single_select', 'multi_select', 'dropdown'].indexOf(type) >= 0;
  var isText = ['short_text', 'paragraph'].indexOf(type) >= 0;
  var isDisplay = ['statement', 'image'].indexOf(type) >= 0;
  var opt = form.querySelector('.js-options');
  var rgx = form.querySelector('.js-regex');
  var jmp = form.querySelector('.js-jumps');
  var cnt = form.querySelector('.js-content');
  if (opt) opt.style.display = isChoice ? '' : 'none';
  if (rgx) rgx.style.display = isText ? '' : 'none';
  if (jmp) jmp.style.display = type === 'single_select' ? '' : 'none';
  if (cnt) cnt.style.display = type === 'statement' ? '' : 'none';
  void isDisplay;
});

// Form Builder：欄位圖片上傳 / Ctrl+V 貼上。
(function initFormImages() {
  document.querySelectorAll('.fb-image').forEach(function (area) {
    var hidden = area.querySelector('input[name=image_path]');
    var preview = area.querySelector('.fb-image-preview');
    var fileInput = area.querySelector('.fb-image-file');
    var removeBtn = area.querySelector('.fb-image-remove');
    if (!hidden || !preview) return;

    function setImage(p) {
      hidden.value = p || '';
      preview.innerHTML = p ? '<img src="' + p + '">' : '';
      if (removeBtn) removeBtn.hidden = !p;
      hidden.dispatchEvent(new Event('change', { bubbles: true })); // 觸發自動儲存
    }
    function upload(file) {
      if (!file) return;
      var fd = new FormData();
      fd.append('image', file);
      preview.innerHTML = '<span class="muted small">上傳中…</span>';
      fetch('/admin/forms/upload-image', { method: 'POST', body: fd })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.path) setImage(d.path);
          else { preview.innerHTML = ''; alert(d.error || '上傳失敗'); }
        })
        .catch(function () { preview.innerHTML = ''; alert('上傳失敗'); });
    }
    if (fileInput)
      fileInput.addEventListener('change', function () {
        if (fileInput.files[0]) upload(fileInput.files[0]);
        fileInput.value = '';
      });
    if (removeBtn) removeBtn.addEventListener('click', function () { setImage(''); });
    area.addEventListener('paste', function (e) {
      var items = (e.clipboardData || {}).items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image') === 0) {
          var f = items[i].getAsFile();
          if (f) { e.preventDefault(); upload(f); return; }
        }
      }
    });
  });
})();

// 工人登錄表單：分段導覽（前端純體驗；整合性由伺服器重算路徑決定）。
(function initWorkerSections() {
  var form = document.querySelector('form[action="/register"]');
  if (!form) return;
  var sections = Array.prototype.slice.call(form.querySelectorAll('.form-section'));
  if (!sections.length) return;
  // 「已驗證帳號」資訊只在第一頁顯示，之後的頁面與摘要頁隱藏以節省版面。
  var identityBox = document.querySelector('.identity');
  var byId = {};
  sections.forEach(function (s) { byId[s.getAttribute('data-section-id')] = s; });
  var history = [];
  var current = sections[0];
  var summaryStep = form.querySelector('.summary-step');
  var summaryBody = summaryStep ? summaryStep.querySelector('.summary-body') : null;

  function computeNext(sec) {
    var jumps = sec.querySelectorAll('input[type=radio][data-jump]');
    for (var i = 0; i < jumps.length; i++) {
      if (jumps[i].checked) return jumps[i].getAttribute('data-jump');
    }
    var idx = sections.indexOf(sec);
    return idx + 1 < sections.length ? sections[idx + 1].getAttribute('data-section-id') : 'submit';
  }
  function isTerminal(sec) {
    var n = computeNext(sec);
    return n === 'submit' || !byId[n];
  }
  function updateNav() {
    sections.forEach(function (sec) {
      var nav = sec.querySelector('.section-nav');
      if (!nav) return;
      var prev = nav.querySelector('.js-prev');
      var next = nav.querySelector('.js-next');
      var review = nav.querySelector('.js-review');
      var terminal = isTerminal(sec);
      if (prev) prev.style.display = sec === current && history.length ? '' : 'none';
      if (next) next.style.display = sec === current && !terminal ? '' : 'none';
      // 走到最後一段時，改成「檢視填寫內容」進入摘要確認頁（而非直接送出）
      if (review) review.style.display = sec === current && terminal ? '' : 'none';
    });
  }
  function show(sec) {
    if (summaryStep) summaryStep.hidden = true;
    sections.forEach(function (s) { s.hidden = s !== sec; });
    if (identityBox) identityBox.hidden = sec !== sections[0]; // 只有第一頁顯示帳號資訊
    current = sec;
    updateNav();
    window.scrollTo(0, 0);
  }

  // ---- 送出前的摘要確認 ----
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function fieldLabel(field) {
    var lab = field.querySelector(':scope > label');
    if (!lab) return '';
    // 去掉必填星號與「可事後修改」徽章，只留欄位名稱本身
    var clone = lab.cloneNode(true);
    clone.querySelectorAll('.req, .badge-editable').forEach(function (el) { el.remove(); });
    return clone.textContent.replace(/\*/g, '').trim();
  }
  function labelOfOption(input) {
    var opt = input.closest('.opt');
    return opt ? opt.textContent.trim() : input.value;
  }
  function otherText(field, baseName) {
    var t = field.querySelector('input[name="' + CSS.escape(baseName + '__other') + '"]');
    return t ? String(t.value).trim() : '';
  }
  // 依欄位內的控制項型別，讀出工人目前填的「顯示值」。
  function fieldValue(field) {
    var sel = field.querySelector('select');
    if (sel) {
      if (sel.value === '__other__') return otherText(field, sel.name) || '（其他，未填）';
      if (!sel.value) return '';
      var o = sel.options[sel.selectedIndex];
      return o ? o.text : sel.value;
    }
    if (field.querySelector('input[type=radio]')) {
      var r = field.querySelector('input[type=radio]:checked');
      if (!r) return '';
      return r.value === '__other__' ? otherText(field, r.name) || '（其他，未填）' : labelOfOption(r);
    }
    if (field.querySelector('input[type=checkbox]')) {
      var vals = [];
      field.querySelectorAll('input[type=checkbox]:checked').forEach(function (c) {
        vals.push(c.value === '__other__' ? otherText(field, c.name) || '（其他，未填）' : labelOfOption(c));
      });
      return vals.join('、');
    }
    var file = field.querySelector('input[type=file]');
    if (file) return file.files && file.files.length ? file.files[0].name : '';
    var input = field.querySelector('input, textarea');
    return input ? String(input.value).trim() : '';
  }
  function buildSummary() {
    if (!summaryBody) return;
    var rows = [];
    history.concat([current]).forEach(function (sec) {
      sec.querySelectorAll('.field').forEach(function (field) {
        var label = fieldLabel(field);
        if (!label) return;
        var val = fieldValue(field);
        var editable = !!field.querySelector(':scope > label .badge-editable');
        rows.push(
          '<div class="sum-row"><div class="sum-label">' + esc(label) +
          (editable ? ' <span class="badge-editable">✏️ 可事後修改</span>' : '') +
          '</div><div class="sum-value">' + (val ? esc(val).replace(/\n/g, '<br>') : '<span class="muted">（未填）</span>') +
          '</div></div>',
        );
      });
    });
    summaryBody.innerHTML = rows.length ? rows.join('') : '<p class="muted">（沒有可顯示的內容）</p>';
  }
  function showSummary() {
    if (!summaryStep) { form.requestSubmit ? form.requestSubmit() : form.submit(); return; }
    buildSummary();
    sections.forEach(function (s) { s.hidden = true; });
    if (identityBox) identityBox.hidden = true; // 摘要頁也不顯示帳號資訊
    summaryStep.hidden = false;
    window.scrollTo(0, 0);
  }
  function hideSummary() {
    if (summaryStep) summaryStep.hidden = true;
    show(current); // current 仍為最後一段
  }
  function requiredOk(sec) {
    var ok = true;
    var firstBad = null;
    sec.querySelectorAll('[required]').forEach(function (el) {
      if (!ok) return;
      var bad = false;
      if (el.type === 'radio' || el.type === 'checkbox') {
        bad = !sec.querySelector('input[name="' + CSS.escape(el.name) + '"]:checked');
      } else if (el.type === 'file') {
        bad = !el.files.length;
      } else {
        bad = !String(el.value).trim();
      }
      if (bad) { ok = false; firstBad = el; }
    });
    if (firstBad && firstBad.focus) firstBad.focus();
    return ok;
  }

  // 在欄位內顯示/清除錯誤訊息（沿用伺服器渲染的 .field / .err / .has-error 結構）。
  function setFieldError(el, msg) {
    var field = el.closest('.field');
    if (!field) return;
    var err = field.querySelector('.err');
    if (msg) {
      field.classList.add('has-error');
      if (!err) { err = document.createElement('p'); err.className = 'err'; field.appendChild(err); }
      err.textContent = msg;
    } else {
      field.classList.remove('has-error');
      if (err) err.textContent = '';
    }
  }
  // 依欄位設定的 regex 驗證單一文字欄位。規則刻意與伺服器 validate.ts 一致：
  // unanchored（new RegExp(regex).test）、空值略過（交給必填）、無效 regex 略過。
  function validateRegex(el) {
    var pat = el.getAttribute('data-regex');
    if (pat == null) return true;
    var val = String(el.value || '').trim();
    if (val === '') { setFieldError(el, ''); return true; }
    var re;
    try { re = new RegExp(pat); } catch (e) { setFieldError(el, ''); return true; }
    if (re.test(val)) { setFieldError(el, ''); return true; }
    setFieldError(el, el.getAttribute('data-regex-msg') || '格式不符合規定');
    return false;
  }
  function regexOk(sec) {
    var ok = true;
    var firstBad = null;
    sec.querySelectorAll('[data-regex]').forEach(function (el) {
      if (!validateRegex(el)) { ok = false; if (!firstBad) firstBad = el; }
    });
    if (firstBad && firstBad.focus) firstBad.focus();
    return ok;
  }
  // 選了「其他」卻沒填自填文字 → 視為未完成（與伺服器 validate.ts 一致，避免送出後才被打回第一頁）。
  function otherOk(sec) {
    var ok = true;
    var firstBad = null;
    sec.querySelectorAll('input[type=text]').forEach(function (t) {
      var n = t.getAttribute('name') || '';
      if (n.slice(-7) !== '__other') return; // 只看 <欄位>__other 自填框
      var base = n.slice(0, -7);
      var box = sec.querySelector('input[name="' + CSS.escape(base) + '"][value="__other__"]');
      var sel = sec.querySelector('select[name="' + CSS.escape(base) + '"]');
      var chosen = (box && box.checked) || (sel && sel.value === '__other__');
      if (chosen && String(t.value).trim() === '') {
        setFieldError(t, '選了「其他」請填寫內容');
        ok = false;
        if (!firstBad) firstBad = t;
      } else if (chosen) {
        setFieldError(t, ''); // 已填 → 清掉舊的「請填寫其他」提示
      }
    });
    if (firstBad && firstBad.focus) firstBad.focus();
    return ok;
  }

  form.addEventListener('click', function (e) {
    var el = e.target;
    if (!el.classList) return;
    if (el.classList.contains('js-next')) {
      e.preventDefault();
      if (!requiredOk(current)) return;
      if (!regexOk(current)) return;
      if (!otherOk(current)) return;
      var n = computeNext(current);
      if (n === 'submit' || !byId[n]) { updateNav(); return; }
      history.push(current);
      show(byId[n]);
    } else if (el.classList.contains('js-prev')) {
      e.preventDefault();
      if (history.length) show(history.pop());
    } else if (el.classList.contains('js-review')) {
      // 最後一段：驗證後進入摘要確認頁
      e.preventDefault();
      if (!requiredOk(current)) return;
      if (!regexOk(current)) return;
      if (!otherOk(current)) return;
      showSummary();
    } else if (el.classList.contains('js-summary-back')) {
      e.preventDefault();
      hideSummary();
    }
  });
  form.addEventListener('change', function (e) {
    if (e.target && e.target.type === 'radio' && e.target.closest('.form-section') === current) updateNav();
  });
  // 送出前先驗證目前（最後一段）的必填與 regex；擋下時一併阻止清空草稿（見下方 submit listener）。
  form.addEventListener('submit', function (e) {
    var okReq = requiredOk(current);
    var okRegex = regexOk(current);
    var okOther = otherOk(current);
    if (!okReq || !okRegex || !okOther) { e.preventDefault(); e.stopImmediatePropagation(); }
  });
  // 即時回饋：離開欄位時驗證（blur 不冒泡故用 capture）；輸入中若已標紅，改對即清除。
  form.addEventListener('blur', function (e) {
    if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-regex')) validateRegex(e.target);
  }, true);
  form.addEventListener('input', function (e) {
    var el = e.target;
    if (!el || !el.hasAttribute || !el.hasAttribute('data-regex')) return;
    var field = el.closest('.field');
    if (field && field.classList.contains('has-error')) validateRegex(el);
  });
  // 伺服器回傳驗證錯誤時，直接跳到第一個含錯誤的區塊並捲到錯誤處；
  // 否則只看到第一頁、看不到原因，會誤以為「送出沒反應／要重寫」。
  var erroredSection = null;
  for (var si = 0; si < sections.length; si++) {
    if (sections[si].querySelector('.has-error')) { erroredSection = sections[si]; break; }
  }
  show(erroredSection || sections[0]);
  if (erroredSection) {
    var firstErr = erroredSection.querySelector('.has-error');
    if (firstErr && firstErr.scrollIntoView) firstErr.scrollIntoView({ block: 'center' });
  }
})();

function debounce(fn, ms) {
  var t;
  return function () { clearTimeout(t); t = setTimeout(fn, ms); };
}

// (1) 系統設定頁：改完任一欄位自動儲存。
(function initSettingsAutosave() {
  var form = document.querySelector('form[action="/admin/settings"]');
  if (!form) return;
  var status = document.getElementById('autosave-status');
  function save() {
    if (status) { status.textContent = '儲存中…'; status.className = 'small muted'; }
    postForm('/admin/settings', form)
      .then(function () {
        if (status) { status.textContent = '✓ 已自動儲存 ' + new Date().toLocaleTimeString(); status.className = 'small ok-text'; }
      })
      .catch(function () {
        if (status) { status.textContent = '✗ 自動儲存失敗'; status.className = 'small err-text'; }
      });
  }
  form.addEventListener('change', debounce(save, 400));
})();

// (2) 表單設定 Form Builder：既有欄位改完即自動儲存（不重整）。
(function initFormBuilderAutosave() {
  var forms = document.querySelectorAll('.fb-field .fb-form');
  if (!forms.length) return;
  forms.forEach(function (form) {
    var save = debounce(function () {
      var btn = form.querySelector('button[type=submit]');
      var orig = btn ? btn.textContent : '';
      if (btn) btn.textContent = '儲存中…';
      postForm(form.action, form)
        .then(function () { if (btn) { btn.textContent = '已儲存 ✓'; setTimeout(function () { btn.textContent = orig; }, 1200); } })
        .catch(function () { if (btn) { btn.textContent = '儲存失敗'; setTimeout(function () { btn.textContent = orig; }, 1500); } });
    }, 500);
    form.addEventListener('change', save);
  });
})();

// (3) 工人登錄表單：自動存草稿到 localStorage（依帳號區隔；不含檔案）。
(function initRegisterDraft() {
  var form = document.querySelector('form[action="/register"]');
  if (!form) return;
  var KEY = 'sitcon_reg_draft:' + (form.getAttribute('data-draft-key') || '');
  // 伺服器草稿的時間戳（epoch 毫秒）；後端已把該草稿灌進表單初值。
  var serverTs = Number(form.getAttribute('data-draft-ts') || '0') || 0;

  function eachNamed(cb) {
    form.querySelectorAll('[name]').forEach(function (el) {
      if (el.type === 'file' || !el.name) return;
      cb(el);
    });
  }

  function applyData(saved) {
    eachNamed(function (el) {
      if (!(el.name in saved)) return;
      var val = saved[el.name];
      if (el.type === 'checkbox') el.checked = Array.isArray(val) && val.indexOf(el.value) >= 0;
      else if (el.type === 'radio') el.checked = el.value === val;
      else el.value = val;
    });
  }

  // 還原：伺服器草稿已由後端帶入表單（跨裝置）；localStorage 若「不比伺服器舊」才覆蓋，
  // 讓同裝置的即時輸入與離線編輯優先，同時避免用舊本機草稿蓋掉別台裝置存的較新版本。
  try {
    var rec = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (rec) {
      var localData = rec.data ? rec.data : rec;          // 相容舊格式（純資料物件、無時間戳）
      var localTs = rec.ts ? Number(rec.ts) : 0;
      if (localData && typeof localData === 'object' && localTs >= serverTs) applyData(localData);
    }
  } catch (e) { /* ignore */ }

  function collect() {
    var data = {};
    eachNamed(function (el) {
      if (el.type === 'checkbox') {
        if (!data[el.name]) data[el.name] = [];
        if (el.checked) data[el.name].push(el.value);
      } else if (el.type === 'radio') {
        if (el.checked) data[el.name] = el.value;
      } else {
        data[el.name] = el.value;
      }
    });
    return data;
  }

  // 存草稿：先寫 localStorage（即時、離線可用），再非阻塞地同步到伺服器（跨裝置）。
  var snapshot = debounce(function () {
    var data = collect();
    try { localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), data: data })); } catch (e) { /* ignore */ }
    try {
      fetch('/register/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        keepalive: true,
      }).catch(function () { /* 離線或失敗：localStorage 仍保有草稿 */ });
    } catch (e) { /* ignore */ }
  }, 500);

  form.addEventListener('input', snapshot);
  form.addEventListener('change', snapshot);
  // 送出成功後伺服器會刪掉草稿；本機這裡一併清掉 localStorage。
  form.addEventListener('submit', function () { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } });
})();

// (4) 工人登錄表單：在「其他…」文字框輸入內容時，自動選取對應的「其他」選項。
//     （放在還原草稿之後，才能對已還原/驗證錯誤重填的其他文字補選。）
(function initOtherAutoselect() {
  // 同時支援登錄表單與免登入的修改頁 /edit/:token（兩者用同一個欄位樣板；每頁只會有其一）。
  var form = document.querySelector('form[action="/register"], form[action^="/edit/"]');
  if (!form) return;
  var SUFFIX = '__other';

  // 「其他」文字框的 name 為 <欄位key>__other，回傳其欄位 key，非其他文字框回傳 null。
  function baseNameOf(el) {
    var n = el.getAttribute('name') || '';
    if (n.length <= SUFFIX.length || n.slice(-SUFFIX.length) !== SUFFIX) return null;
    return n.slice(0, -SUFFIX.length);
  }

  // 找出該欄位的「其他」控制項（單選 radio / 多選 checkbox / 下拉 select）。
  function otherControlFor(base) {
    var box = form.querySelector('input[name="' + CSS.escape(base) + '"][value="__other__"]');
    if (box) return box;
    var sel = form.querySelector('select[name="' + CSS.escape(base) + '"]');
    if (sel && sel.querySelector('option[value="__other__"]')) return sel;
    return null;
  }

  function selectOther(text) {
    var base = baseNameOf(text);
    if (base === null || String(text.value).trim() === '') return; // 只在有輸入時自動選取
    var ctrl = otherControlFor(base);
    if (!ctrl) return;
    var changed = false;
    if (ctrl.tagName === 'SELECT') {
      if (ctrl.value !== '__other__') { ctrl.value = '__other__'; changed = true; }
    } else if (!ctrl.checked) {
      ctrl.checked = true;
      changed = true;
    }
    if (changed) ctrl.dispatchEvent(new Event('change', { bubbles: true })); // 讓分段導覽/草稿重算
  }

  form.addEventListener('input', function (e) {
    if (e.target && baseNameOf(e.target) !== null) selectOther(e.target);
  });

  // 初次載入（含還原草稿 / 驗證錯誤重填後）：其他文字已有值就補選。
  form.querySelectorAll('input[type=text]').forEach(function (el) {
    if (baseNameOf(el) !== null) selectOther(el);
  });
})();

// (5) 修改頁 /edit/:token：Discord 式「未儲存變更」浮動列。
//     有欄位變動才從頁面底部滑出；「還原」把表單恢復成伺服器渲染的原值。
(function initUnsavedBar() {
  var form = document.querySelector('form[action^="/edit/"]');
  var bar = document.getElementById('savebar');
  if (!form || !bar) return;
  var fallback = document.getElementById('edit-save-fallback');
  if (fallback) fallback.hidden = true; // 無 JS 備援鈕；JS 可用時改走浮動列

  // 序列化表單目前狀態；檔案欄位以檔名+大小代表內容。
  // 控制項順序固定（DOM 順序），直接串接比對即可。
  function serialize() {
    var parts = [];
    new FormData(form).forEach(function (val, key) {
      parts.push(key + '=' + (val instanceof File ? '\u0000file:' + val.name + ':' + val.size : String(val)));
    });
    return parts.join('\u0001');
  }

  var baseline = serialize();
  var submitting = false;

  function refresh() {
    var dirty = !submitting && serialize() !== baseline;
    bar.hidden = !dirty;
    document.body.classList.toggle('has-savebar', dirty);
  }

  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  // 送出後把儲存鈕換成轉圈載入狀態，並鎖住兩顆按鈕避免重複送出
  form.addEventListener('submit', function () {
    submitting = true;
    var save = bar.querySelector('button[type=submit]');
    if (save) {
      save.disabled = true;
      save.innerHTML = '<span class="spinner"></span>儲存中…';
    }
    var resetBtn = document.getElementById('savebar-reset');
    if (resetBtn) resetBtn.disabled = true;
  });

  var reset = document.getElementById('savebar-reset');
  if (reset) reset.addEventListener('click', function () {
    form.reset(); // 回到伺服器渲染的初值（含「其他」的勾選與文字）
    refresh();
  });

  // 有未儲存變更時，關閉／重整頁面前提醒
  window.addEventListener('beforeunload', function (e) {
    if (submitting || serialize() === baseline) return;
    e.preventDefault();
    e.returnValue = '';
  });
})();

// ---------- App 內建瀏覽器（Telegram / LINE 等）偵測與逃脫 ----------
// 網站無法強制 Telegram 改用外部瀏覽器；只能偵測後引導使用者跳出，
// 否則 Google OAuth 會因 disallowed_useragent 被擋。
(function () {
  var banner = document.getElementById('webview-banner');
  if (!banner) return;
  var ua = navigator.userAgent || '';
  var isTelegram = /Telegram/i.test(ua) || typeof window.TelegramWebviewProxy !== 'undefined';
  var isLine = /\bLine\//i.test(ua);
  var isMeta = /FBAN|FBAV|Instagram/i.test(ua);
  var isAndroidWv = /Android/.test(ua) && /; wv\)/.test(ua);
  var isIosWv = /iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  if (!(isTelegram || isLine || isMeta || isAndroidWv || isIosWv)) return;

  // LINE 支援用網址參數直接改開外部瀏覽器，不用問直接跳。
  if (isLine && !/[?&]openExternalBrowser=1/.test(location.href)) {
    location.href = location.href + (location.search ? '&' : '?') + 'openExternalBrowser=1';
    return;
  }

  banner.hidden = false;

  var openBtn = document.getElementById('webview-open');
  if (openBtn) openBtn.addEventListener('click', function () {
    if (/Android/.test(ua)) {
      // intent:// 會交給系統預設瀏覽器開啟
      location.href = 'intent://' + location.host + location.pathname + location.search +
        '#Intent;scheme=' + location.protocol.replace(':', '') + ';end';
    } else {
      // 部分 iOS webview 允許 x-safari- scheme 跳到 Safari
      location.href = 'x-safari-' + location.href;
    }
  });

  var copyBtn = document.getElementById('webview-copy');
  if (copyBtn) copyBtn.addEventListener('click', function () {
    var url = location.href;
    function done() { copyBtn.textContent = '已複製，請貼到瀏覽器開啟'; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { window.prompt('請手動複製網址', url); });
    } else {
      window.prompt('請手動複製網址', url);
    }
  });
})();
