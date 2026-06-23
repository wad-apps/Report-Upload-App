// ===== 設定（docs/config.js で一元管理） =====
var GAS_URL         = window.APP_CONFIG.GAS_URL;
var OAUTH_CLIENT_ID = window.APP_CONFIG.OAUTH_CLIENT_ID;

// ===== 状態 =====
var state = {
  idToken:        null,
  yearMonth:      null,
  selectedDriver: null,
  exportData:     null,
};
var cachedListData = null; // { drivers, stats, yearMonth } — 一覧画面の戻り時に再フェッチを省略

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', function() {
  var now = new Date();
  var ym  = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  document.getElementById('input-yearmonth').value = ym;
  state.yearMonth = ym;

  var savedToken = sessionStorage.getItem('idToken');
  initGis();

  if (savedToken) {
    state.idToken = savedToken;
    showScreen('main');
    loadDashboard();
  } else {
    google.accounts.id.prompt();
  }

  setupEvents();
});

function setupEvents() {
  document.getElementById('btn-logout').addEventListener('click', function() {
    sessionStorage.removeItem('idToken');
    state.idToken = null;
    google.accounts.id.disableAutoSelect();
    var loadingEl = document.getElementById('login-loading');
    if (loadingEl) loadingEl.classList.add('hidden');
    document.getElementById('login-error').classList.add('hidden');
    showScreen('login');
    google.accounts.id.prompt();
  });

  document.getElementById('input-yearmonth').addEventListener('change', function(e) {
    state.yearMonth = e.target.value;
    cachedListData = null;
    loadDashboard();
  });

  document.getElementById('btn-refresh').addEventListener('click', function() {
    cachedListData = null;
    loadDashboard();
  });

  document.getElementById('btn-back-to-list').addEventListener('click', function() {
    showScreen('main');
    loadDashboard(false); // キャッシュがあれば再フェッチしない
  });

  document.getElementById('btn-save-correction').addEventListener('click', function() { handleSaveCorrection(false); });
  document.getElementById('btn-confirm-month').addEventListener('click', handleConfirmMonth);

  document.getElementById('btn-export').addEventListener('click', handleExport);
  document.getElementById('btn-modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-download-csv').addEventListener('click', downloadCsv);

  document.getElementById('modal-overlay').addEventListener('click', function() {
    closeModal();
    closeDriverModal();
  });

  document.getElementById('btn-driver-master').addEventListener('click', openDriverMasterScreen);
  document.getElementById('btn-back-from-master').addEventListener('click', function() { showScreen('main'); loadDashboard(false); });
  document.getElementById('btn-add-driver').addEventListener('click', function() { openDriverModal(null); });
  document.getElementById('btn-driver-modal-cancel').addEventListener('click', closeDriverModal);
  document.getElementById('btn-driver-modal-save').addEventListener('click', saveDriver);
}

// ===== Googleサインイン =====
var _authInProgress = false;

function initGis() {
  google.accounts.id.initialize({
    client_id:   OAUTH_CLIENT_ID,
    callback:    handleCredentialResponse,
    auto_select: false, // savedToken競合を避けるため常に無効
  });
  google.accounts.id.renderButton(
    document.getElementById('g-signin-btn'),
    { theme: 'outline', size: 'large', locale: 'ja', text: 'signin_with' }
  );
}

function handleCredentialResponse(response) {
  if (_authInProgress) return;
  _authInProgress = true;

  var idToken   = response.credential;
  var loadingEl = document.getElementById('login-loading');
  var errorEl   = document.getElementById('login-error');
  if (loadingEl) loadingEl.classList.remove('hidden');
  errorEl.classList.add('hidden');

  adminPost({ action: 'adminGetOverview', idToken: idToken, yearMonth: state.yearMonth })
    .then(function() {
      state.idToken = idToken;
      sessionStorage.setItem('idToken', idToken);
      _authInProgress = false;
      if (loadingEl) loadingEl.classList.add('hidden');
      showScreen('main');
      loadDashboard();
    })
    .catch(function() {
      _authInProgress = false;
      if (loadingEl) loadingEl.classList.add('hidden');
      errorEl.classList.remove('hidden');
    });
}

// ===== ダッシュボード読み込み =====
// force=false のとき同一年月のキャッシュがあれば再フェッチしない（一覧戻り用）
function loadDashboard(force) {
  var ym = state.yearMonth;
  if (force === false && cachedListData && cachedListData.yearMonth === ym) {
    renderStats(cachedListData.stats);
    renderDriverTable(cachedListData.drivers);
    return;
  }

  document.getElementById('driver-tbody').innerHTML =
    '<tr><td colspan="7" class="empty-cell">読み込み中...</td></tr>';

  adminPost({ action: 'adminGetDriverList', idToken: state.idToken, yearMonth: ym })
    .then(function(res) {
      var totalOverKm = (res.drivers || []).reduce(function(sum, d) { return sum + (d.totalOverKm || 0); }, 0);
      var enrichedStats = Object.assign({}, res.stats, { totalOverKm: totalOverKm });
      cachedListData = { drivers: res.drivers, stats: enrichedStats, yearMonth: ym };
      renderStats(enrichedStats);
      renderDriverTable(res.drivers);
    }).catch(function() {});
}

function renderStats(stats) {
  if (!stats) return;
  document.getElementById('stat-total').textContent     = stats.total;
  document.getElementById('stat-pending').textContent   = stats.pending;
  document.getElementById('stat-confirmed').textContent = stats.confirmed;
  document.getElementById('stat-error').textContent     = stats.ocrError;
  document.getElementById('stat-over-km').textContent   = (stats.totalOverKm != null ? stats.totalOverKm : '-') + (stats.totalOverKm != null ? ' km' : '');
}

// ===== ドライバー一覧レンダリング =====
function renderDriverTable(drivers) {
  var tbody = document.getElementById('driver-tbody');
  if (!drivers.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">この月の提出データはありません</td></tr>';
    return;
  }

  tbody.innerHTML = drivers.map(function(d) {
    var badgeClass   = 'badge-' + d.status;
    var billingText  = d.billingAmount ? '¥' + d.billingAmount.toLocaleString() : '-';
    var ocrTime      = d.ocrTime || '-';
    var btnLabel     = d.isConfirmed ? '確認済み' : '確認する';
    var btnDisabled  = d.status !== '確認待ち' && d.status !== '確定' ? 'disabled' : '';
    var distText     = d.isConfirmed && d.totalDistance ? d.totalDistance + ' km' : '-';
    var overKmText   = d.isConfirmed && d.totalOverKm   ? d.totalOverKm   + ' km' : '-';
    var overKmStyle  = d.isConfirmed && d.totalOverKm > 0 ? ' style="color:var(--warning);font-weight:600"' : '';
    var fileLink     = d.fileUrl
      ? '<a href="' + escHtml(d.fileUrl) + '" target="_blank" class="btn btn-sm btn-ghost">画像 ↗</a>'
      : '';
    var originalLink = d.originalFileId
      ? '<a href="https://drive.google.com/file/d/' + escHtml(d.originalFileId) + '/view" target="_blank" class="btn btn-sm btn-ghost">原本 ↗</a>'
      : '';
    var folderLink   = d.folderUrl
      ? '<a href="' + escHtml(d.folderUrl) + '" target="_blank" class="btn btn-sm btn-ghost">フォルダ ↗</a>'
      : '';
    return [
      '<tr>',
      '<td><strong>' + escHtml(d.driverName) + '</strong></td>',
      '<td>' + escHtml(d.site) + '</td>',
      '<td>' + (d.workingDays || '-') + ' 日</td>',
      '<td>' + billingText + '</td>',
      '<td>' + distText + '</td>',
      '<td' + overKmStyle + '>' + overKmText + '</td>',
      '<td><span class="badge ' + badgeClass + '">' + d.status + '</span></td>',
      '<td style="color:var(--text-sub);font-size:12px">' + ocrTime + '</td>',
      '<td style="display:flex;gap:6px;align-items:center">' + fileLink + originalLink + folderLink +
          '<button class="btn btn-sm btn-outline btn-review" ' + btnDisabled +
          ' data-uid="' + escHtml(d.lineUserId) + '"' +
          ' data-name="' + escHtml(d.driverName) + '"' +
          ' data-site="' + escHtml(d.site || '') + '"' +
          ' data-folder="' + escHtml(d.folderUrl || '') + '">' + btnLabel + '</button></td>',
      '</tr>',
    ].join('');
  }).join('');

  // 確認ボタンのイベントを一括登録
  tbody.querySelectorAll('.btn-review').forEach(function(btn) {
    btn.addEventListener('click', function() {
      btn.disabled = true;
      btn.textContent = '読み込み中...';
      openOcrScreen(btn.dataset.uid, btn.dataset.name, btn.dataset.site || '', btn.dataset.folder);
    });
  });
}

// ===== OCR確認画面 =====
function openOcrScreen(lineUserId, driverName, site, folderUrl) {
  state.selectedDriver = { lineUserId: lineUserId, driverName: driverName, site: site || '' };
  var titleSite = site ? '　' + site : '';
  document.getElementById('ocr-header-title').textContent = driverName + titleSite + '　' + state.yearMonth;
  document.getElementById('btn-confirm-month').disabled = true;

  var folderLinkEl = document.getElementById('ocr-folder-link');
  if (folderUrl) {
    folderLinkEl.href = folderUrl;
    folderLinkEl.classList.remove('hidden');
  } else {
    folderLinkEl.classList.add('hidden');
  }

  adminPost({
    action:      'adminGetOcrDetail',
    idToken:     state.idToken,
    lineUserId:  lineUserId,
    yearMonth:   state.yearMonth,
    site:        site || '',
  }).then(function(res) {
    var fileLinkEl = document.getElementById('ocr-file-link');
    if (res.fileUrl) {
      fileLinkEl.href = res.fileUrl;
      fileLinkEl.classList.remove('hidden');
    } else {
      fileLinkEl.classList.add('hidden');
    }

    var originalLinkEl = document.getElementById('ocr-original-link');
    if (res.originalFileId) {
      originalLinkEl.href = 'https://drive.google.com/file/d/' + encodeURIComponent(res.originalFileId) + '/view';
      originalLinkEl.classList.remove('hidden');
    } else {
      originalLinkEl.classList.add('hidden');
    }

    var resolvedFolder = res.folderUrl || folderUrl;
    var folderLinkEl   = document.getElementById('ocr-folder-link');
    if (resolvedFolder) {
      folderLinkEl.href = resolvedFolder;
      folderLinkEl.classList.remove('hidden');
    } else {
      folderLinkEl.classList.add('hidden');
    }

    renderOcrTable(res.days, res.driver);
    renderExpenses(res.expenses || []);
    renderNoteText(res.noteText || '');
    renderAttachments(res.attachments || []);
    showScreen('ocr');
  }).catch(function(err) {
    if (err.message !== 'unauthorized') showToast('データの読み込みに失敗しました');
  });
}

function renderOcrTable(days, driver) {
  var unitPrice = driver.unitPrice || 0;
  var tbody     = document.getElementById('ocr-tbody');

  tbody.innerHTML = days.map(function(d) {
    var displayStart  = d.fixedStart || d.start || '';
    var displayEnd    = d.fixedEnd   || d.end   || '';
    var isWorking     = displayStart !== '';
    var dotClass      = isWorking ? 'yes' : 'no';
    var startModified = (d.fixedStart && d.fixedStart !== d.start) ? ' modified' : '';
    var endModified   = (d.fixedEnd   && d.fixedEnd   !== d.end)   ? ' modified' : '';
    var dist          = d.distance || 0;
    var overKm        = d.overKm   || 0;
    var rowClass      = dist > 100 ? ' class="over-km-row"' : '';
    var overKmCell    = overKm > 0
      ? '<span class="over-km-badge">+' + overKm + '</span>'
      : '<span style="color:var(--text-sub)">-</span>';
    return [
      '<tr' + rowClass + '>',
      '<td style="font-weight:600;color:var(--text-sub)">' + d.day + '</td>',
      '<td><input type="text" class="time-input' + startModified + '" data-day="' + d.day + '" data-field="start"' +
          ' value="' + displayStart + '" placeholder="--:--"></td>',
      '<td><input type="text" class="time-input' + endModified   + '" data-day="' + d.day + '" data-field="end"' +
          ' value="' + displayEnd + '" placeholder="--:--"></td>',
      '<td><input type="number" class="km-input" data-day="' + d.day + '" data-field="kosu"' +
          ' value="' + (d.kosu || '') + '" min="0" placeholder="-"></td>',
      '<td><input type="number" class="km-input" data-day="' + d.day + '" data-field="distance"' +
          ' value="' + (dist || '') + '" min="0" placeholder="-"></td>',
      '<td style="text-align:right">' + overKmCell + '</td>',
      '<td><span class="working-dot ' + dotClass + '"></span></td>',
      '</tr>',
    ].join('');
  }).join('');

  // 入力変更時に稼働ドット・集計・超過kmハイライトをリアルタイム更新
  tbody.querySelectorAll('.time-input').forEach(function(input) {
    input.addEventListener('input', function() {
      input.classList.add('modified');
      updateOcrSummary(unitPrice);
    });
  });
  tbody.querySelectorAll('.km-input[data-field="distance"]').forEach(function(input) {
    input.addEventListener('input', function() {
      updateOcrSummary(unitPrice);
      var row  = input.closest('tr');
      var dist = parseFloat(input.value) || 0;
      var overKm = Math.max(0, dist - 100);
      var overCell = row.cells[5];
      if (dist > 100) {
        row.classList.add('over-km-row');
        overCell.innerHTML = '<span class="over-km-badge">+' + overKm + '</span>';
      } else {
        row.classList.remove('over-km-row');
        overCell.innerHTML = '<span style="color:var(--text-sub)">-</span>';
      }
    });
  });

  document.getElementById('ocr-unit-price').textContent = '¥' + unitPrice.toLocaleString();
  updateOcrSummary(unitPrice);
  document.getElementById('btn-confirm-month').disabled = false;
}

function updateOcrSummary(unitPrice) {
  var rows          = document.querySelectorAll('#ocr-tbody tr');
  var working       = 0;
  var totalDistance = 0;
  var totalOverKm   = 0;
  rows.forEach(function(row) {
    var startInput = row.querySelector('[data-field="start"]');
    var distInput  = row.querySelector('[data-field="distance"]');
    var dotEl      = row.querySelector('.working-dot');
    if (!startInput) return;
    var isWorking = startInput.value.trim() !== '';
    if (isWorking) working++;
    if (dotEl) dotEl.className = 'working-dot ' + (isWorking ? 'yes' : 'no');
    var dist = distInput ? (parseFloat(distInput.value) || 0) : 0;
    totalDistance += dist;
    totalOverKm   += Math.max(0, dist - 100);
  });
  document.getElementById('ocr-working-days').textContent    = working;
  document.getElementById('ocr-billing').textContent         = '¥' + (working * unitPrice).toLocaleString();
  document.getElementById('ocr-total-distance').textContent  = totalDistance || '-';
  document.getElementById('ocr-total-over-km').textContent   = totalOverKm   || '-';
}

function renderExpenses(expenses) {
  var tbody = document.getElementById('expense-tbody');
  if (!expenses || expenses.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">立替なし</td></tr>';
    return;
  }
  tbody.innerHTML = expenses.map(function(e) {
    var amount = e.amount !== null && e.amount !== '' ? '¥' + Number(e.amount).toLocaleString() : '-';
    return [
      '<tr>',
      '<td>' + escHtml(String(e.row)) + '</td>',
      '<td>' + escHtml(e.category || '') + '</td>',
      '<td>' + amount + '</td>',
      '<td>' + escHtml(e.note || '') + '</td>',
      '</tr>',
    ].join('');
  }).join('');
}

function renderNoteText(noteText) {
  var el = document.getElementById('note-content');
  el.textContent = noteText || '（記載なし）';
}

function renderAttachments(attachments) {
  var el = document.getElementById('attachment-links');
  if (!attachments || attachments.length === 0) {
    el.innerHTML = '<span class="empty-cell" style="display:block;padding:12px 20px">添付なし</span>';
    return;
  }
  el.innerHTML = attachments.map(function(a, i) {
    var label = escHtml(a.fileName || ('添付' + (i + 1)));
    return '<a href="' + escHtml(a.fileUrl) + '" target="_blank" class="attachment-link">' +
      (i + 1) + '. ' + label + ' ↗</a>';
  }).join('');
}

// ===== 修正保存 =====
// silent=true のとき: トースト非表示、操作ログ非記録（確定前の自動保存用）
function handleSaveCorrection(silent) {
  var corrections = [];
  document.querySelectorAll('#ocr-tbody tr').forEach(function(row) {
    var startInput = row.querySelector('[data-field="start"]');
    var endInput   = row.querySelector('[data-field="end"]');
    var kosuInput  = row.querySelector('[data-field="kosu"]');
    var distInput  = row.querySelector('[data-field="distance"]');
    if (!startInput) return;
    corrections.push({
      day:           parseInt(startInput.dataset.day, 10),
      fixedStart:    startInput.value.trim(),
      fixedEnd:      endInput.value.trim(),
      fixedKosu:     kosuInput  ? (parseFloat(kosuInput.value)  || 0) : 0,
      fixedDistance: distInput  ? (parseFloat(distInput.value)  || 0) : 0,
    });
  });

  var btn = document.getElementById('btn-save-correction');
  btn.disabled = true;
  btn.textContent = '保存中...';

  return adminPost({
    action:      'adminSaveCorrection',
    idToken:     state.idToken,
    lineUserId:  state.selectedDriver.lineUserId,
    yearMonth:   state.yearMonth,
    site:        state.selectedDriver.site || '',
    corrections: corrections,
    silent:      !!silent,
  }).then(function() {
    if (!silent) showToast('修正を保存しました');
  }).catch(function() {
    if (!silent) showToast('保存に失敗しました');
  }).then(function() {
    btn.disabled = false;
    btn.textContent = '修正を保存';
  });
}

// ===== 月次確定 =====
function handleConfirmMonth() {
  if (!confirm(state.selectedDriver.driverName + ' の ' + state.yearMonth + ' を確定します。よろしいですか？')) return;

  var confirmBtn = document.getElementById('btn-confirm-month');
  confirmBtn.disabled = true;
  confirmBtn.textContent = '確定中...';

  // 修正を保存してから確定（silent=true: ログなし・トーストなし）
  handleSaveCorrection(true).then(function() {
    return adminPost({
      action:     'adminConfirmMonth',
      idToken:    state.idToken,
      lineUserId: state.selectedDriver.lineUserId,
      yearMonth:  state.yearMonth,
      site:       state.selectedDriver.site || '',
    });
  }).then(function(res) {
    cachedListData = null; // 一覧を次回強制再フェッチ
    showToast('確定しました。稼働' + res.workingDays + '日 / ¥' + res.billingAmount.toLocaleString());
    confirmBtn.textContent = '確定済み';
  }).catch(function() {
    showToast('確定に失敗しました');
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'この月を確定する';
  });
}

// ===== CSV出力 =====
function handleExport() {
  adminPost({
    action:     'adminExportData',
    idToken: state.idToken,
    yearMonth:  state.yearMonth,
  }).then(function(res) {
    state.exportData = res.rows;
    renderExportTable(res.rows);
    document.getElementById('export-yearmonth-label').textContent = state.yearMonth + ' の確定済みデータ';
    document.getElementById('modal-export').classList.remove('hidden');
    document.getElementById('modal-overlay').classList.remove('hidden');
  });
}

function renderExportTable(rows) {
  var tbody = document.getElementById('export-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">確定済みデータはありません</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(function(r) {
    return [
      '<tr>',
      '<td>' + escHtml(r.driverName) + '</td>',
      '<td>' + escHtml(r.site) + '</td>',
      '<td>' + r.workingDays + '</td>',
      '<td>' + r.totalHours + '</td>',
      '<td>¥' + (r.unitPrice || 0).toLocaleString() + '</td>',
      '<td>¥' + (r.billingAmount || 0).toLocaleString() + '</td>',
      '<td>' + (r.totalKosu || 0) + '</td>',
      '<td>' + (r.totalDistance || 0) + '</td>',
      '<td>' + (r.totalOverKm || 0) + '</td>',
      '</tr>',
    ].join('');
  }).join('');
}

function downloadCsv() {
  if (!state.exportData) return;
  var rows    = state.exportData;
  var headers = ['ドライバー名', '現場', '稼働日数', '実働時間(h)', '単価', '請求金額', '個数合計', '走行距離合計(km)', '超過km合計', '確定日時'];
  var csv     = [headers.join(',')];
  rows.forEach(function(r) {
    csv.push([
      '"' + (r.driverName    || '') + '"',
      '"' + (r.site          || '') + '"',
      r.workingDays    || 0,
      r.totalHours     || 0,
      r.unitPrice      || 0,
      r.billingAmount  || 0,
      r.totalKosu      || 0,
      r.totalDistance  || 0,
      r.totalOverKm    || 0,
      '"' + (r.confirmedAt   || '') + '"',
    ].join(','));
  });
  var now     = new Date();
  var dateSfx = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') + '_' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0');
  var blob = new Blob(['﻿' + csv.join('\n')], { type: 'text/csv;charset=utf-8' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = '月報集計_' + state.yearMonth + '_' + dateSfx + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function closeModal() {
  document.getElementById('modal-export').classList.add('hidden');
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ===== ドライバーマスタ管理 =====
var _driverMasterIsNew = false; // モーダルの追加/編集モードフラグ
var _driverEditOriginalSite = ''; // 編集時の元の現場名（重複行防止・修正1）

function openDriverMasterScreen() {
  showScreen('driver-master');
  document.getElementById('unregistered-tbody').innerHTML =
    '<tr><td colspan="4" class="empty-cell">読み込み中...</td></tr>';
  document.getElementById('driver-master-tbody').innerHTML =
    '<tr><td colspan="7" class="empty-cell">読み込み中...</td></tr>';

  adminPost({ action: 'adminGetDriverMaster', idToken: state.idToken })
    .then(function(res) {
      renderUnregisteredTable(res.unregistered || []);
      renderDriverMasterTable(res.drivers || []);
    }).catch(function() {
      showToast('マスタの読み込みに失敗しました');
    });
}

function renderUnregisteredTable(rows) {
  var tbody = document.getElementById('unregistered-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">未登録ユーザーはいません</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(function(r) {
    return [
      '<tr>',
      '<td style="color:var(--text-sub);font-size:12px">' + escHtml(r.timestamp) + '</td>',
      '<td><strong>' + escHtml(r.displayName) + '</strong></td>',
      '<td style="font-size:12px;font-family:monospace">' + escHtml(r.lineUserId) + '</td>',
      '<td style="display:flex;gap:6px">' +
        '<button class="btn btn-sm btn-outline btn-register-driver"' +
          ' data-uid="' + escHtml(r.lineUserId) + '"' +
          ' data-name="' + escHtml(r.displayName) + '">登録</button>' +
        '<button class="btn btn-sm btn-ghost btn-ignore-unreg"' +
          ' data-uid="' + escHtml(r.lineUserId) + '">無視</button>' +
      '</td>',
      '</tr>',
    ].join('');
  }).join('');

  tbody.querySelectorAll('.btn-register-driver').forEach(function(btn) {
    btn.addEventListener('click', function() {
      openDriverModal({ lineUserId: btn.dataset.uid, name: btn.dataset.name, site: '', unitPrice: 0, baseWorkMinutes: 0, breakMinutes: 0, _isFromUnregistered: true });
    });
  });

  tbody.querySelectorAll('.btn-ignore-unreg').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (!confirm('この未登録ユーザーを一覧から削除しますか？')) return;
      btn.disabled = true;
      adminPost({ action: 'adminDeleteUnregistered', idToken: state.idToken, lineUserId: btn.dataset.uid })
        .then(function() {
          showToast('削除しました');
          openDriverMasterScreen();
        }).catch(function() {
          showToast('削除に失敗しました');
          btn.disabled = false;
        });
    });
  });
}

function renderDriverMasterTable(drivers) {
  var tbody = document.getElementById('driver-master-tbody');
  if (!drivers.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">登録済みドライバーはいません</td></tr>';
    return;
  }
  tbody.innerHTML = drivers.map(function(d) {
    var stopped     = d.status === '停止';
    var statusLabel = stopped ? '停止' : '稼働';
    var toggleLabel = stopped ? '再開' : '停止';
    var toggleNext  = stopped ? '稼働' : '停止';
    return [
      '<tr' + (stopped ? ' style="opacity:.55"' : '') + '>',
      '<td><strong>' + escHtml(d.name) + '</strong></td>',
      '<td>' + escHtml(d.site) + '</td>',
      '<td>¥' + Number(d.unitPrice || 0).toLocaleString() + '</td>',
      '<td>' + (d.baseWorkMinutes || 0) + '</td>',
      '<td>' + (d.breakMinutes || 0) + '</td>',
      '<td><span class="badge badge-' + statusLabel + '">' + statusLabel + '</span></td>',
      '<td style="display:flex;gap:6px;flex-wrap:wrap">',
      '<button class="btn btn-sm btn-outline btn-edit-driver"' +
          ' data-uid="' + escHtml(d.lineUserId) + '"' +
          ' data-name="' + escHtml(d.name) + '"' +
          ' data-site="' + escHtml(d.site) + '"' +
          ' data-unit="' + (d.unitPrice || 0) + '"' +
          ' data-base="' + (d.baseWorkMinutes || 0) + '"' +
          ' data-break="' + (d.breakMinutes || 0) + '">編集</button>',
      '<button class="btn btn-sm btn-ghost btn-toggle-driver"' +
          ' data-uid="' + escHtml(d.lineUserId) + '"' +
          ' data-name="' + escHtml(d.name) + '"' +
          ' data-site="' + escHtml(d.site) + '"' +
          ' data-next="' + toggleNext + '">' + toggleLabel + '</button>',
      '<button class="btn btn-sm btn-ghost btn-delete-driver"' +
          ' data-uid="' + escHtml(d.lineUserId) + '"' +
          ' data-name="' + escHtml(d.name) + '"' +
          ' data-site="' + escHtml(d.site) + '">完全削除</button>',
      '</td>',
      '</tr>',
    ].join('');
  }).join('');

  tbody.querySelectorAll('.btn-edit-driver').forEach(function(btn) {
    btn.addEventListener('click', function() {
      openDriverModal({
        lineUserId:      btn.dataset.uid,
        name:            btn.dataset.name,
        site:            btn.dataset.site,
        unitPrice:       Number(btn.dataset.unit),
        baseWorkMinutes: Number(btn.dataset.base),
        breakMinutes:    Number(btn.dataset.break),
      });
    });
  });

  tbody.querySelectorAll('.btn-toggle-driver').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var next  = btn.dataset.next;
      var label = btn.dataset.name + (btn.dataset.site ? '（' + btn.dataset.site + '）' : '');
      if (!confirm(label + ' を' + (next === '停止' ? '停止' : '再開') + 'しますか？')) return;
      btn.disabled = true;
      adminPost({ action: 'adminSetDriverStatus', idToken: state.idToken, lineUserId: btn.dataset.uid, site: btn.dataset.site, status: next })
        .then(function() {
          showToast(next === '停止' ? '停止しました' : '再開しました');
          openDriverMasterScreen();
        }).catch(function() {
          showToast('更新に失敗しました');
          btn.disabled = false;
        });
    });
  });

  tbody.querySelectorAll('.btn-delete-driver').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var label = btn.dataset.name + (btn.dataset.site ? '（' + btn.dataset.site + '）' : '');
      if (!confirm(label + ' を完全に削除しますか？\n単価・基準時間などの設定も失われます。一時停止なら「停止」を使ってください。')) return;
      btn.disabled = true;
      adminPost({ action: 'adminDeleteDriver', idToken: state.idToken, lineUserId: btn.dataset.uid, site: btn.dataset.site })
        .then(function() {
          showToast('削除しました');
          openDriverMasterScreen();
        }).catch(function() {
          showToast('削除に失敗しました');
          btn.disabled = false;
        });
    });
  });
}

function openDriverModal(driver) {
  _driverMasterIsNew = !driver || !!driver._isFromUnregistered;
  _driverEditOriginalSite = (driver && !_driverMasterIsNew) ? (driver.site || '') : '';
  document.getElementById('modal-driver-title').textContent = _driverMasterIsNew ? 'ドライバー追加' : 'ドライバー編集';

  var uidInput = document.getElementById('driver-uid');
  uidInput.value    = driver ? (driver.lineUserId || '') : '';
  uidInput.readOnly = !_driverMasterIsNew;
  uidInput.style.background = _driverMasterIsNew ? '' : '#f1f3f4';

  document.getElementById('driver-name').value       = driver ? (driver.name || '') : '';
  document.getElementById('driver-site').value       = driver ? (driver.site || '') : '';
  document.getElementById('driver-unit-price').value = driver ? (driver.unitPrice || '') : '';
  document.getElementById('driver-base-min').value   = driver ? (driver.baseWorkMinutes || '') : '';
  document.getElementById('driver-break-min').value  = driver ? (driver.breakMinutes || '') : '';

  document.getElementById('modal-driver').classList.remove('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('driver-name').focus();
}

function closeDriverModal() {
  document.getElementById('modal-driver').classList.add('hidden');
  document.getElementById('modal-overlay').classList.add('hidden');
}

function saveDriver() {
  var uid  = document.getElementById('driver-uid').value.trim();
  var name = document.getElementById('driver-name').value.trim();
  if (!uid)  { showToast('LINEユーザーIDを入力してください'); return; }
  if (!name) { showToast('ドライバー名を入力してください'); return; }

  var saveBtn = document.getElementById('btn-driver-modal-save');
  saveBtn.disabled    = true;
  saveBtn.textContent = '保存中...';

  adminPost({
    action:          'adminSaveDriver',
    idToken:         state.idToken,
    lineUserId:      uid,
    name:            name,
    site:            document.getElementById('driver-site').value.trim(),
    unitPrice:       Number(document.getElementById('driver-unit-price').value) || 0,
    baseWorkMinutes: Number(document.getElementById('driver-base-min').value) || 0,
    breakMinutes:    Number(document.getElementById('driver-break-min').value) || 0,
    isNew:           _driverMasterIsNew,
    originalSite:    _driverEditOriginalSite,
  }).then(function() {
    closeDriverModal();
    showToast('保存しました');
    openDriverMasterScreen();
  }).catch(function() {
    showToast('保存に失敗しました');
  }).then(function() {
    saveBtn.disabled    = false;
    saveBtn.textContent = '保存';
  });
}

// ===== API =====
function adminPost(payload) {
  return fetch(GAS_URL, {
    method:   'POST',
    headers:  { 'Content-Type': 'text/plain' },
    body:     JSON.stringify(payload),
    redirect: 'follow',
  })
  .then(function(res) { return res.json(); })
  .then(function(json) {
    if (json.error === 'unauthorized') {
      sessionStorage.removeItem('idToken');
      state.idToken = null;
      showScreen('login');
      throw new Error('unauthorized');
    }
    if (json.error) throw new Error(json.error);
    return json;
  });
}

// ===== ユーティリティ =====
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById('screen-' + name).classList.add('active');
}

var toastTimer = null;
function showToast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { el.classList.add('hidden'); }, 3000);
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
