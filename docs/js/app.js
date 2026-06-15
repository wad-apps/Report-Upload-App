// ===== 設定（後で実際の値に差し替え） =====
var LIFF_ID        = '2010213495-32sSJXPi';
var GAS_URL        = 'https://script.google.com/macros/s/AKfycbxhBY8vJ74CzghhEfnZi1QitH1U0qeOFfQ-aEG8Z9bfIchXqHLDBF3BEmFEKdSma3dJTw/exec';
var TAG_REDIRECT_URL = 'https://webhook.site/f549c80d-9d4d-4d22-84b2-e98310c8ab66'; // 動作検証用。流入URL確定後に差し替える

// ===== 状態 =====
var state = {
  lineUserId:       null,
  displayName:      null,
  driver:           null,
  reports:          [],
  selectedFile:     null,
  selectedMimeType: null,
  attachmentFiles:  [],
};

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', function() {
  initApp();
});

function initApp() {
  var now  = new Date();
  var yyyy = now.getFullYear();
  var mm   = now.getMonth() + 1;

  var yearEl = document.getElementById('select-year');
  for (var y = yyyy - 1; y <= yyyy + 1; y++) {
    var yOpt = document.createElement('option');
    yOpt.value = String(y);
    yOpt.textContent = y + '年';
    if (y === yyyy) yOpt.selected = true;
    yearEl.appendChild(yOpt);
  }
  var monthEl = document.getElementById('select-month');
  for (var m = 1; m <= 12; m++) {
    var mOpt = document.createElement('option');
    mOpt.value = String(m).padStart(2, '0');
    mOpt.textContent = m + '月';
    if (m === mm) mOpt.selected = true;
    monthEl.appendChild(mOpt);
  }

  liff.init({ liffId: LIFF_ID })
    .then(function() {
      if (!liff.isLoggedIn()) {
        liff.login();
        return Promise.reject('not_logged_in');
      }
      return liff.getProfile();
    })
    .then(function(profile) {
      state.lineUserId  = profile.userId;
      state.displayName = profile.displayName;
      // プロフィール＋履歴を1回のAPIで取得
      return gasPost({ action: 'bootstrap', lineUserId: profile.userId });
    })
    .then(function(res) {
      state.driver  = res.driver;
      state.reports = res.reports || [];
      updateDriverInfo(res.driver);
      renderReportList(state.reports);
      setupEventListeners();
      showScreen('main');
    })
    .catch(function(err) {
      if (err === 'not_logged_in') return;
      showScreen('main');
      showToast('認証に失敗しました。マスタ登録を確認してください。');
      setupEventListeners();
    });
}

// ===== API呼び出し =====

function uploadReport(yearMonth, file, uploadId) {
  var isPdf = file.type === 'application/pdf';

  var consentPayload = {
    consent:      true,
    consentAt:    new Date().toISOString(),
    agreedItems:  ['1', '2', '3', '4', '5', 'bill'],
    uploadId:     uploadId,
  };

  if (isPdf) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var base64 = e.target.result.split(',')[1];
        gasPost(Object.assign({
          action:     'uploadReport',
          lineUserId: state.lineUserId,
          yearMonth:  yearMonth,
          mimeType:   'application/pdf',
          fileBase64: base64,
          fileName:   file.name,
        }, consentPayload)).then(resolve).catch(reject);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // 画像: 向きに応じて分割してから送信（縦長→上下、横長→左右）
  return splitForOcr(file).then(function(halves) {
    return gasPost(Object.assign({
      action:           'uploadReport',
      lineUserId:       state.lineUserId,
      yearMonth:        yearMonth,
      mimeType:         'image/jpeg',
      fileBase64:       halves.full,
      fileBase64First:  halves.first,
      fileBase64Second: halves.second,
      fileName:         file.name,
    }, consentPayload));
  });
}

// 画像の向きを判定して分割し、フル + 前半 + 後半 の base64 を返す
function splitForOcr(file) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function() {
      URL.revokeObjectURL(url);

      var MAX   = 2000;
      var scale = Math.min(1, MAX / Math.max(img.width, img.height));
      var w     = Math.round(img.width  * scale);
      var h     = Math.round(img.height * scale);

      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      var full = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];

      var c1 = document.createElement('canvas');
      var c2 = document.createElement('canvas');

      // 境界付近の行が欠落しないよう25%重複させて分割する
      // 前半: 0〜65%、後半: 35〜100%
      if (w > h) {
        // 横長: 左右分割
        var cut1 = Math.round(w * 0.65);
        var cut2 = Math.round(w * 0.35);
        c1.width = cut1; c1.height = h;
        c1.getContext('2d').drawImage(canvas, 0, 0, cut1, h, 0, 0, cut1, h);
        c2.width = w - cut2; c2.height = h;
        c2.getContext('2d').drawImage(canvas, cut2, 0, w - cut2, h, 0, 0, w - cut2, h);
      } else {
        // 縦長: 上下分割
        var cut1 = Math.round(h * 0.65);
        var cut2 = Math.round(h * 0.35);
        c1.width = w; c1.height = cut1;
        c1.getContext('2d').drawImage(canvas, 0, 0, w, cut1, 0, 0, w, cut1);
        c2.width = w; c2.height = h - cut2;
        c2.getContext('2d').drawImage(canvas, 0, cut2, w, h - cut2, 0, 0, w, h - cut2);
      }

      resolve({
        full:   full,
        first:  c1.toDataURL('image/jpeg', 0.85).split(',')[1],
        second: c2.toDataURL('image/jpeg', 0.85).split(',')[1],
      });
    };
    img.onerror = reject;
    img.src = url;
  });
}

function gasPost(payload) {
  return fetch(GAS_URL, {
    method:   'POST',
    // GASはapplication/jsonだとCORSプリフライトが発生するためtext/plainで送る
    headers:  { 'Content-Type': 'text/plain' },
    body:     JSON.stringify(payload),
    redirect: 'follow',
  })
  .then(function(res) { return res.json(); })
  .then(function(json) {
    if (json.error) throw new Error(json.error);
    return json;
  });
}

// ===== イベントリスナー =====

function setupEventListeners() {
  document.getElementById('btn-camera').addEventListener('click', function() {
    var input = document.getElementById('file-input');
    input.setAttribute('capture', 'environment');
    input.setAttribute('accept', 'image/*');
    input.click();
  });

  document.getElementById('btn-file').addEventListener('click', function() {
    var input = document.getElementById('file-input');
    input.removeAttribute('capture');
    input.setAttribute('accept', 'image/*,application/pdf');
    input.click();
  });

  document.getElementById('file-input').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (file) handleFileSelected(file);
  });

  document.getElementById('btn-cancel-file').addEventListener('click', clearFileSelection);
  document.getElementById('btn-submit').addEventListener('click', handleSubmit);

  document.getElementById('btn-add-attachment').addEventListener('click', function() {
    document.getElementById('attachment-input').click();
  });
  document.getElementById('attachment-input').addEventListener('change', function(e) {
    var files = e.target.files;
    if (!files || !files.length) return;
    var over = state.attachmentFiles.length + files.length > 10;
    var addCount = Math.min(files.length, 10 - state.attachmentFiles.length);
    for (var i = 0; i < addCount; i++) {
      state.attachmentFiles.push(files[i]);
    }
    if (over) showToast('添付ファイルは最大10件です');
    renderAttachmentList();
    e.target.value = '';
  });

  document.querySelectorAll('.submit-check').forEach(function(cb) {
    cb.addEventListener('change', updateSubmitEnabled);
  });

  document.getElementById('btn-to-line').addEventListener('click', function() {
    if (TAG_REDIRECT_URL) {
      // 流入URLにサイレントアクセスしてタグを登録してからLINEに戻る
      fetch(TAG_REDIRECT_URL, { mode: 'no-cors' })
        .catch(function() {})
        .then(function() { liff.closeWindow(); });
    } else {
      liff.closeWindow();
    }
  });
}

// ===== ファイル選択 =====

function handleFileSelected(file) {
  state.selectedFile     = file;
  state.selectedMimeType = file.type;

  document.getElementById('upload-area').classList.add('hidden');
  document.getElementById('preview-area').classList.remove('hidden');
  document.getElementById('preview-filename').textContent = file.name;

  var img = document.getElementById('preview-image');
  if (file.type.startsWith('image/')) {
    img.src = URL.createObjectURL(file);
    img.classList.remove('hidden');
  } else {
    img.classList.add('hidden');
  }

  updateSubmitEnabled();
}

function clearFileSelection() {
  state.selectedFile     = null;
  state.selectedMimeType = null;
  document.getElementById('file-input').value = '';
  document.getElementById('upload-area').classList.remove('hidden');
  document.getElementById('preview-area').classList.add('hidden');
  document.getElementById('preview-image').classList.add('hidden');
  updateSubmitEnabled();
}

function updateSubmitEnabled() {
  var hasFile    = !!state.selectedFile;
  var allChecked = Array.prototype.every.call(
    document.querySelectorAll('.submit-check'),
    function(c) { return c.checked; }
  );
  document.getElementById('btn-submit').disabled = !(hasFile && allChecked);
}

// ===== 送信 =====

function getSelectedYearMonth() {
  return document.getElementById('select-year').value + '-' + document.getElementById('select-month').value;
}

function handleSubmit() {
  var yearMonth = getSelectedYearMonth();
  if (!yearMonth)          { showToast('対象年月を選択してください'); return; }
  if (!state.selectedFile) { showToast('ファイルを選択してください'); return; }
  if (!state.lineUserId)   { showToast('ログインし直してください'); return; }

  var alreadySubmitted = state.reports.some(function(r) { return r.yearMonth === yearMonth; });
  if (alreadySubmitted) {
    var ym = yearMonth.replace('-', '年') + '月';
    showConfirm(ym + '分の月報はすでに提出済みです。上書きして再提出しますか？', function() {
      doSubmit(yearMonth);
    });
    return;
  }
  doSubmit(yearMonth);
}

function doSubmit(yearMonth) {
  var uploadId = Math.random().toString(36).substr(2, 6).toUpperCase();

  showOverlay(true);
  updateOverlayText('送信中...');

  uploadReport(yearMonth, state.selectedFile, uploadId)
    .then(function() {
      if (state.attachmentFiles.length === 0) return Promise.resolve();
      updateOverlayText('添付ファイルをアップロード中... 1/' + state.attachmentFiles.length);
      return uploadAttachments(yearMonth, state.attachmentFiles, 0, uploadId);
    })
    .then(function() {
      showOverlay(false);
      var ym = yearMonth.replace('-', '年') + '月';
      document.getElementById('done-message').textContent = ym + '分の月報を送信しました';
      showScreen('done');
    })
    .catch(function(err) {
      showOverlay(false);
      showToast('送信失敗: ' + err.message);
    });
}

function showConfirm(message, onOk) {
  document.getElementById('confirm-msg').textContent = message;
  document.getElementById('confirm-overlay').classList.remove('hidden');
  document.getElementById('btn-confirm-ok').onclick = function() {
    document.getElementById('confirm-overlay').classList.add('hidden');
    onOk();
  };
  document.getElementById('btn-confirm-cancel').onclick = function() {
    document.getElementById('confirm-overlay').classList.add('hidden');
  };
}

function uploadAttachments(yearMonth, files, index, uploadId) {
  if (index >= files.length) return Promise.resolve();
  var file = files[index];

  var getBase64 = file.type === 'application/pdf'
    ? new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function(e) { resolve(e.target.result.split(',')[1]); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      })
    : resizeImage(file);

  return getBase64.then(function(base64) {
    return gasPost({
      action:     'uploadAttachment',
      lineUserId: state.lineUserId,
      yearMonth:  yearMonth,
      mimeType:   file.type.startsWith('image/') ? 'image/jpeg' : file.type,
      fileBase64: base64,
      fileName:   file.name,
      index:      index,
      uploadId:   uploadId,
    });
  }).then(function() {
    var next = index + 1;
    if (next < files.length) {
      updateOverlayText('添付ファイルをアップロード中... ' + (next + 1) + '/' + files.length);
    }
    return uploadAttachments(yearMonth, files, next, uploadId);
  });
}

function resizeImage(file) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function() {
      URL.revokeObjectURL(url);
      var MAX   = 2000;
      var scale = Math.min(1, MAX / Math.max(img.width, img.height));
      var w     = Math.round(img.width  * scale);
      var h     = Math.round(img.height * scale);
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ===== 添付ファイル =====

function renderAttachmentList() {
  var list = document.getElementById('attachment-list');
  if (state.attachmentFiles.length === 0) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = state.attachmentFiles.map(function(file, i) {
    var span = document.createElement('span');
    span.textContent = file.name;
    return '<div class="attachment-item">' +
      '<span class="attachment-name">' + escHtml(file.name) + '</span>' +
      '<button class="btn-remove-attachment" data-index="' + i + '">✕</button>' +
      '</div>';
  }).join('');
  list.querySelectorAll('.btn-remove-attachment').forEach(function(btn) {
    btn.addEventListener('click', function() {
      state.attachmentFiles.splice(parseInt(btn.dataset.index, 10), 1);
      renderAttachmentList();
    });
  });
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===== 提出履歴 =====

function renderReportList(reports) {
  var container = document.getElementById('report-list');
  if (!reports.length) {
    container.innerHTML = '<p class="empty-text">提出済みの月報はありません</p>';
    return;
  }

  reports.sort(function(a, b) { return b.yearMonth.localeCompare(a.yearMonth); });

  container.innerHTML = reports.map(function(r) {
    var fileLabel  = r.fileType === 'pdf' ? 'PDF' : '写真';
    var ymParts    = (r.yearMonth || '').split('-');
    var ymLabel    = ymParts.length === 2
      ? ymParts[0] + '年' + parseInt(ymParts[1], 10) + '月分'
      : r.yearMonth;
    var submitDate = '';
    if (r.timestamp) {
      var d = new Date(r.timestamp);
      submitDate = (d.getMonth() + 1) + '/' + d.getDate() + ' 提出 · ';
    }
    return [
      '<div class="report-item">',
      '  <div class="report-item-left">',
      '    <div class="yearmonth">' + ymLabel + '</div>',
      '    <div class="filetype">' + submitDate + fileLabel + '</div>',
      '  </div>',
      '  <span class="status-badge status-' + r.status + '">' + r.status + '</span>',
      '</div>',
    ].join('');
  }).join('');
}

// ===== UI ヘルパー =====

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s) {
    s.classList.remove('active');
  });
  document.getElementById('screen-' + name).classList.add('active');
}

function updateDriverInfo(driver) {
  var text = driver ? (driver.name + ' / ' + driver.site) : state.displayName || '---';
  document.getElementById('driver-info').textContent = text;
}

function showOverlay(visible) {
  var el = document.getElementById('overlay-uploading');
  visible ? el.classList.remove('hidden') : el.classList.add('hidden');
}

function updateOverlayText(text) {
  document.getElementById('overlay-text').textContent = text;
}

var toastTimer = null;
function showToast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { el.classList.add('hidden'); }, 3000);
}
