// 事務員向け管理API
// Script Properties に OAUTH_CLIENT_ID・ALLOWED_EMAILS を設定しておくこと

function verifyIdToken_(idToken) {
  if (!idToken) return null;

  // 同一トークンの重複tokeninfo呼び出しを避けるため5分キャッシュ
  var cache    = CacheService.getScriptCache();
  var keyBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken);
  var cacheKey = 'v_' + keyBytes.map(function(b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('').substring(0, 40);
  var cached   = cache.get(cacheKey);
  if (cached) return cached;

  var clientId = PropertiesService.getScriptProperties().getProperty('OAUTH_CLIENT_ID');
  if (!clientId) throw new Error('OAUTH_CLIENT_ID not set in Script Properties');
  try {
    var res  = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    var data = JSON.parse(res.getContentText());
    if (data.error)                                    return null;
    if (data.aud !== clientId)                         return null;
    if (!data.email_verified)                          return null;
    if (Number(data.exp) < Date.now() / 1000)          return null;
    var email = data.email.toLowerCase();
    cache.put(cacheKey, email, 300);
    return email;
  } catch (e) {
    Logger.log('verifyIdToken_ error: ' + e.message);
    return null;
  }
}

function handleAdminPost(payload) {
  var email = verifyIdToken_(payload.idToken);
  if (!email) return jsonResponse({ error: 'unauthorized' });

  var allowed = (PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAILS') || '')
    .toLowerCase().split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  if (allowed.indexOf(email) === -1) return jsonResponse({ error: 'unauthorized' });

  switch (payload.action) {
    case 'adminGetOverview':    return handleAdminGetOverview_(payload);
    case 'adminGetDriverList':  return handleAdminGetDriverList_(payload);
    case 'adminGetOcrDetail':   return handleAdminGetOcrDetail_(payload);
    case 'adminSaveCorrection': return handleAdminSaveCorrection_(payload, email);
    case 'adminConfirmMonth':   return handleAdminConfirmMonth_(payload, email);
    case 'adminExportData':     return handleAdminExportData_(payload);
    default: return jsonResponse({ error: 'invalid admin action' });
  }
}

// ===== 概要統計 =====

function handleAdminGetOverview_(payload) {
  var yearMonth = payload.yearMonth;
  var ss        = SpreadsheetApp.openById(SHEET_ID);
  var data      = ss.getSheetByName(SHEET_RECEIVED).getDataRange().getValues();

  // SHEET_RECEIVED: [4]=yearMonth, [8]=status
  var stats = { total: 0, pending: 0, confirmed: 0, ocrError: 0 };
  data.slice(1).forEach(function(row) {
    if (normalizeYearMonth_(row[4]) !== yearMonth) return;
    stats.total++;
    if      (row[8] === '確認待ち')  stats.pending++;
    else if (row[8] === '確定')      stats.confirmed++;
    else if (row[8] === 'OCRエラー') stats.ocrError++;
  });

  return jsonResponse({ stats: stats, yearMonth: yearMonth });
}

// ===== ドライバー別提出状況一覧 =====

function handleAdminGetDriverList_(payload) {
  var yearMonth = payload.yearMonth;
  var ss        = SpreadsheetApp.openById(SHEET_ID);

  var recvData    = ss.getSheetByName(SHEET_RECEIVED).getDataRange().getValues();
  var driverData  = ss.getSheetByName(SHEET_DRIVER).getDataRange().getValues();
  var ocrData     = ss.getSheetByName(SHEET_OCR).getDataRange().getValues();
  var monthlyData = ss.getSheetByName(SHEET_MONTHLY).getDataRange().getValues();

  // driverMap: uid + '|' + site → driver info
  var driverMap = {};
  var uidFallbackMap = {}; // uid → first driver (backward compat for old rows without site)
  driverData.slice(1).forEach(function(row) {
    if (!row[0]) return;
    var key = row[0] + '|' + (row[2] || '');
    driverMap[key] = { name: row[1], site: row[2], unitPrice: row[3] };
    if (!uidFallbackMap[row[0]]) uidFallbackMap[row[0]] = driverMap[key];
  });

  // 対象年月の受信ファイルをドライバー×現場ごとに集約（最新1件）
  // SHEET_RECEIVED: [1]=uid, [3]=site, [4]=yearMonth, [5]=fileType, [7]=fileUrl, [8]=status, [9]=ocrTime
  var submissionMap = {};
  recvData.slice(1).forEach(function(row) {
    if (normalizeYearMonth_(row[4]) !== yearMonth) return;
    var uid  = row[1];
    var site = row[3] || '';
    var key  = uid + '|' + site;
    var ts   = row[0] ? new Date(row[0]).getTime() : 0;
    if (!submissionMap[key] || ts > submissionMap[key].ts) {
      submissionMap[key] = {
        ts:        ts,
        uid:       uid,
        site:      site,
        fileUrl:   row[7],
        fileType:  row[5],
        status:    row[8],
        ocrTime:   row[9] ? Utilities.formatDate(new Date(row[9]), 'Asia/Tokyo', 'MM/dd HH:mm') : '',
      };
    }
  });

  // 稼働日数（修正後を優先）。SHEET_OCR: [2]=site, [3]=yearMonth, [5]=start, [9]=fixedStart
  var workingDaysMap = {};
  ocrData.slice(1).forEach(function(row) {
    if (normalizeYearMonth_(row[3]) !== yearMonth) return;
    var uid      = row[0];
    var site     = row[2] || '';
    var key      = uid + '|' + site;
    var startVal = row[9] || row[5]; // 修正後開始時間 or OCR開始時間
    var isWorking = startVal !== '' && startVal !== null;
    if (isWorking) workingDaysMap[key] = (workingDaysMap[key] || 0) + 1;
  });

  // 月次確定データ。SHEET_MONTHLY: [2]=site, [3]=yearMonth, [8]=billingAmount
  var confirmedMap = {};
  monthlyData.slice(1).forEach(function(row) {
    if (normalizeYearMonth_(row[3]) === yearMonth) {
      var site = row[2] || '';
      confirmedMap[row[0] + '|' + site] = { billingAmount: row[8] };
    }
  });

  var driverFolderUrls = getMonthDriverFolderUrls_(yearMonth);

  var list = Object.keys(submissionMap).map(function(key) {
    var sub       = submissionMap[key];
    var d         = driverMap[key] || uidFallbackMap[sub.uid] || {};
    var wd        = workingDaysMap[key] || 0;
    var up        = d.unitPrice || 0;
    var folderKey = (d.name || '') + (d.site ? '_' + d.site : '');
    return {
      lineUserId:    sub.uid,
      driverName:    d.name || '',
      site:          d.site || '',
      unitPrice:     up,
      fileUrl:       sub.fileUrl,
      fileType:      sub.fileType,
      status:        sub.status,
      ocrTime:       sub.ocrTime,
      workingDays:   wd,
      billingAmount: confirmedMap[key] ? confirmedMap[key].billingAmount : wd * up,
      isConfirmed:   !!confirmedMap[key],
      folderUrl:     driverFolderUrls[folderKey] || '',
    };
  });

  list.sort(function(a, b) { return a.driverName.localeCompare(b.driverName, 'ja'); });
  return jsonResponse({ drivers: list, yearMonth: yearMonth });
}

// ===== OCR詳細（日別データ） =====

function handleAdminGetOcrDetail_(payload) {
  var lineUserId = payload.lineUserId;
  var yearMonth  = payload.yearMonth;
  var site       = payload.site || '';
  var ss         = SpreadsheetApp.openById(SHEET_ID);

  // SHEET_OCR: [0]=uid, [2]=site, [3]=yearMonth, [4]=day, [5]=start, [6]=end, [7]=isWorking, [8]=status, [9]=fixedStart, [10]=fixedEnd
  var ocrData = ss.getSheetByName(SHEET_OCR).getDataRange().getValues();
  var days = [];
  ocrData.slice(1).forEach(function(row) {
    if (row[0] !== lineUserId || normalizeYearMonth_(row[3]) !== yearMonth || (row[2] || '') !== site) return;
    days.push({
      day:        row[4],
      start:      normalizeTime_(row[5]),
      end:        normalizeTime_(row[6]),
      isWorking:  row[7],
      status:     row[8],
      fixedStart: normalizeTime_(row[9]),
      fixedEnd:   normalizeTime_(row[10]),
    });
  });
  days.sort(function(a, b) { return a.day - b.day; });

  // SHEET_RECEIVED: [1]=uid, [3]=site, [4]=yearMonth, [7]=fileUrl, [12]=noteText
  var recvData = ss.getSheetByName(SHEET_RECEIVED).getDataRange().getValues();
  var fileUrl  = '';
  var noteText = '';
  recvData.slice(1).forEach(function(row) {
    if (row[1] === lineUserId && normalizeYearMonth_(row[4]) === yearMonth && (row[3] || '') === site) {
      fileUrl  = row[7];
      noteText = row[12] || '';
    }
  });

  // 立替明細。SHEET_EXPENSE: [0]=uid, [2]=site, [3]=yearMonth, [4]=row#, [5]=cat, [6]=amt, [7]=note
  var expenses = [];
  var expSheet = ss.getSheetByName(SHEET_EXPENSE);
  if (expSheet) {
    expSheet.getDataRange().getValues().slice(1).forEach(function(row) {
      if (row[0] !== lineUserId || normalizeYearMonth_(row[3]) !== yearMonth || (row[2] || '') !== site) return;
      expenses.push({
        row:      row[4],
        category: row[5],
        amount:   row[6],
        note:     row[7],
      });
    });
    expenses.sort(function(a, b) { return a.row - b.row; });
  }

  // 添付ファイル。SHEET_ATTACHMENT: [1]=uid, [3]=site, [4]=yearMonth, [5]=index, [6]=fileName, [8]=fileUrl
  var attachments = [];
  var attSheet = ss.getSheetByName(SHEET_ATTACHMENT);
  if (attSheet) {
    attSheet.getDataRange().getValues().slice(1).forEach(function(row) {
      if (row[1] !== lineUserId || normalizeYearMonth_(row[4]) !== yearMonth || (row[3] || '') !== site) return;
      attachments.push({
        index:    row[5],
        fileName: row[6],
        fileUrl:  row[8],
      });
    });
    attachments.sort(function(a, b) { return a.index - b.index; });
  }

  return jsonResponse({
    days:        days,
    fileUrl:     fileUrl,
    driver:      getDriverByUserIdAndSite_(lineUserId, site) || {},
    yearMonth:   yearMonth,
    expenses:    expenses,
    noteText:    noteText,
    attachments: attachments,
  });
}

// ===== OCR修正保存 =====

function handleAdminSaveCorrection_(payload, email) {
  var lineUserId  = payload.lineUserId;
  var yearMonth   = payload.yearMonth;
  var site        = payload.site || '';
  var corrections = payload.corrections; // [{ day, fixedStart, fixedEnd }]

  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_OCR);
  var data  = sheet.getDataRange().getValues();

  var corrMap = {};
  corrections.forEach(function(c) { corrMap[c.day] = c; });

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    // SHEET_OCR: [2]=site, [3]=yearMonth, [4]=day, [5]=ocrStart, [6]=ocrEnd, [7]=isWorking(col8), [8]=status(col9), [9]=fixedStart(col10), [10]=fixedEnd(col11)
    if (row[0] !== lineUserId || normalizeYearMonth_(row[3]) !== yearMonth || (row[2] || '') !== site) continue;
    var c = corrMap[row[4]];
    if (!c) continue;
    var ocrStart  = normalizeTime_(row[5]);
    var ocrEnd    = normalizeTime_(row[6]);
    var isWorking = c.fixedStart !== '';
    sheet.getRange(i + 1, 8).setValue(isWorking);
    sheet.getRange(i + 1, 9).setValue('修正済み');
    sheet.getRange(i + 1, 10).setValue(c.fixedStart !== ocrStart ? c.fixedStart : '');
    sheet.getRange(i + 1, 11).setValue(c.fixedEnd   !== ocrEnd   ? c.fixedEnd   : '');
  }

  SpreadsheetApp.flush();
  appendAuditLog_(email, '修正', lineUserId, '', yearMonth, '', corrections.length + '件', '');
  return jsonResponse({ status: 'ok' });
}

// ===== 月次確定 =====

function handleAdminConfirmMonth_(payload, email) {
  var lineUserId = payload.lineUserId;
  var yearMonth  = payload.yearMonth;
  var site       = payload.site || '';
  var driver     = getDriverByUserIdAndSite_(lineUserId, site);
  if (!driver) return jsonResponse({ error: 'driver not found' });

  var ss      = SpreadsheetApp.openById(SHEET_ID);
  var ocrData = ss.getSheetByName(SHEET_OCR).getDataRange().getValues();

  // SHEET_OCR: [2]=site, [3]=yearMonth, [5]=ocrStart, [6]=ocrEnd, [9]=fixedStart, [10]=fixedEnd
  var workingDays  = 0;
  var totalMinutes = 0;
  ocrData.slice(1).forEach(function(row) {
    if (row[0] !== lineUserId || normalizeYearMonth_(row[3]) !== yearMonth || (row[2] || '') !== site) return;
    var startStr = normalizeTime_(row[9]) || normalizeTime_(row[5]);
    var endStr   = normalizeTime_(row[10]) || normalizeTime_(row[6]);
    if (!startStr) return;
    workingDays++;
    var s = timeToMinutes_(startStr);
    var e = timeToMinutes_(endStr);
    if (s !== null && e !== null && e > s) totalMinutes += e - s;
  });

  var billingAmount = workingDays * (driver.unitPrice || 0);

  // 月次確定シートへ書き込み（既存行は上書き）。SHEET_MONTHLY: [2]=site, [3]=yearMonth
  var monthSheet = ss.getSheetByName(SHEET_MONTHLY);
  var monthData  = monthSheet.getDataRange().getValues();
  var targetRow  = -1;
  for (var i = 1; i < monthData.length; i++) {
    if (monthData[i][0] === lineUserId && normalizeYearMonth_(monthData[i][3]) === yearMonth && (monthData[i][2] || '') === site) {
      targetRow = i + 1; break;
    }
  }
  var rowValues = [
    lineUserId, driver.name, site, yearMonth, workingDays,
    totalMinutes, 0, driver.unitPrice, billingAmount, new Date()
  ];
  if (targetRow > 0) {
    monthSheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    monthSheet.appendRow(rowValues);
  }

  // 受信ファイルのステータスを「確定」に更新（SHEET_RECEIVED: [1]=uid, [3]=site, [4]=yearMonth, [8]=status col9）
  var recvSheet = ss.getSheetByName(SHEET_RECEIVED);
  var recvData  = recvSheet.getDataRange().getValues();
  for (var j = 1; j < recvData.length; j++) {
    if (recvData[j][1] === lineUserId && normalizeYearMonth_(recvData[j][4]) === yearMonth && (recvData[j][3] || '') === site) {
      recvSheet.getRange(j + 1, 9).setValue('確定');
    }
  }

  appendAuditLog_(email, '確定', lineUserId, driver.name, yearMonth, '', '稼働' + workingDays + '日/¥' + billingAmount, '');
  return jsonResponse({ status: 'ok', workingDays: workingDays, billingAmount: billingAmount });
}

// ===== 集計データ出力 =====

function handleAdminExportData_(payload) {
  var yearMonth   = payload.yearMonth;
  var ss          = SpreadsheetApp.openById(SHEET_ID);
  var monthlyData = ss.getSheetByName(SHEET_MONTHLY).getDataRange().getValues();

  // SHEET_MONTHLY: [1]=name, [2]=site, [3]=yearMonth, [4]=workingDays, [5]=totalMin, [7]=unitPrice, [8]=billingAmount, [9]=confirmedAt
  var rows = monthlyData.slice(1)
    .filter(function(row) { return normalizeYearMonth_(row[3]) === yearMonth; })
    .map(function(row) {
      return {
        driverName:    row[1],
        site:          row[2] || '',
        yearMonth:     row[3],
        workingDays:   row[4],
        totalHours:    row[5] ? Math.round(row[5] / 60 * 10) / 10 : 0,
        unitPrice:     row[7],
        billingAmount: row[8],
        confirmedAt:   row[9] ? Utilities.formatDate(new Date(row[9]), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : '',
      };
    });

  rows.sort(function(a, b) { return a.driverName.localeCompare(b.driverName, 'ja'); });
  return jsonResponse({ rows: rows, yearMonth: yearMonth });
}

// ===== 操作ログ =====

function appendAuditLog_(email, action, lineUserId, driverName, yearMonth, before, after, note) {
  try {
    var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_LOG);
    if (!sheet) return;
    sheet.appendRow([new Date(), email, action, lineUserId, driverName, yearMonth, before || '', after || '', note || '']);
  } catch (e) {
    Logger.log('appendAuditLog_ error: ' + e.message);
  }
}

// 対象年月のドライバーフォルダURL一覧を { driverName: url } で返す
function getMonthDriverFolderUrls_(yearMonth) {
  var result = {};
  try {
    var rootFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    var monthIter  = rootFolder.getFoldersByName(yearMonth);
    if (!monthIter.hasNext()) return result;
    var monthFolder  = monthIter.next();
    var driverIter   = monthFolder.getFolders();
    while (driverIter.hasNext()) {
      var f = driverIter.next();
      result[f.getName()] = 'https://drive.google.com/drive/folders/' + f.getId();
    }
  } catch (e) {
    Logger.log('getMonthDriverFolderUrls_ error: ' + e.message);
  }
  return result;
}

// ===== ユーティリティ =====

// Sheets が "2026-05" を Date 型に変換することがあるため、どちらでも "YYYY-MM" 文字列に正規化する
function normalizeYearMonth_(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM');
  }
  return String(val).trim();
}

// Sheets が "08:00" を時刻型（1899-12-30ベースのDate）で返すことがあるため "HH:mm" に正規化する
function normalizeTime_(val) {
  if (val === null || val === undefined || val === '') return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'HH:mm');
  }
  var str = String(val).trim();
  if (str.indexOf('T') !== -1) {
    try { return Utilities.formatDate(new Date(str), 'Asia/Tokyo', 'HH:mm'); } catch(e) {}
  }
  return str;
}

function timeToMinutes_(timeStr) {
  if (!timeStr) return null;
  var parts = String(timeStr).split(':');
  if (parts.length < 2) return null;
  var h = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}
