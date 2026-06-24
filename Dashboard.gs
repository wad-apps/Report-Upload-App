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
    case 'adminGetDriverMaster': return handleAdminGetDriverMaster_();
    case 'adminSaveDriver':      return handleAdminSaveDriver_(payload, email);
    case 'adminSetDriverStatus': return handleAdminSetDriverStatus_(payload, email);
    case 'adminDeleteDriver':    return handleAdminDeleteDriver_(payload, email);
    case 'adminDeleteUnregistered': return handleAdminDeleteUnregistered_(payload, email);
    default: return jsonResponse({ error: 'invalid admin action' });
  }
}

// ===== 概要統計 =====

function handleAdminGetOverview_(payload) {
  var yearMonth = payload.yearMonth;
  var ss        = SpreadsheetApp.openById(getConfig_().sheetId);
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

  // 月次確定から超過km合計を集計。SHEET_MONTHLY: [3]=yearMonth, [13]=totalOverKm
  var monthlyData  = ss.getSheetByName(SHEET_MONTHLY).getDataRange().getValues();
  var totalOverKm  = 0;
  monthlyData.slice(1).forEach(function(row) {
    if (normalizeYearMonth_(row[3]) === yearMonth) totalOverKm += sheetValueToNumber_(row[13]);
  });

  return jsonResponse({ stats: stats, yearMonth: yearMonth, totalOverKm: totalOverKm });
}

// ===== ドライバー別提出状況一覧 =====

function handleAdminGetDriverList_(payload) {
  var yearMonth = payload.yearMonth;
  var ss        = SpreadsheetApp.openById(getConfig_().sheetId);

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
  // SHEET_RECEIVED: [1]=uid, [3]=site, [4]=yearMonth, [5]=fileType, [6]=fileId, [7]=fileUrl, [8]=status, [9]=ocrTime, [14]=folderUrl, [15]=originalFileId
  var submissionMap = {};
  recvData.slice(1).forEach(function(row) {
    if (normalizeYearMonth_(row[4]) !== yearMonth) return;
    var uid  = row[1];
    var site = row[3] || '';
    var key  = uid + '|' + site;
    var ts   = row[0] ? new Date(row[0]).getTime() : 0;
    if (!submissionMap[key] || ts > submissionMap[key].ts) {
      submissionMap[key] = {
        ts:             ts,
        uid:            uid,
        site:           site,
        fileId:         row[6] || '',
        fileUrl:        row[7],
        fileType:       row[5],
        status:         row[8],
        ocrTime:        row[9] ? Utilities.formatDate(new Date(row[9]), 'Asia/Tokyo', 'MM/dd HH:mm') : '',
        folderUrl:      row[14] || '',
        originalFileId: row[15] || '',
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

  // OCR集計（確認前プレビュー用）。SHEET_OCR: [13]=ocrKosu, [14]=ocrDistance, [15]=fixedKosu, [16]=fixedDistance
  var ocrTotalsMap = {};
  ocrData.slice(1).forEach(function(row) {
    if (normalizeYearMonth_(row[3]) !== yearMonth) return;
    var uid  = row[0];
    var site = row[2] || '';
    var key  = uid + '|' + site;
    var dist = (row[16] !== null && row[16] !== '') ? sheetValueToNumber_(row[16]) : sheetValueToNumber_(row[14]);
    var kosu = (row[15] !== null && row[15] !== '') ? sheetValueToNumber_(row[15]) : sheetValueToNumber_(row[13]);
    if (!ocrTotalsMap[key]) ocrTotalsMap[key] = { totalKosu: 0, totalDistance: 0, totalOverKm: 0 };
    ocrTotalsMap[key].totalDistance += dist;
    ocrTotalsMap[key].totalKosu     += kosu;
    ocrTotalsMap[key].totalOverKm   += calcDailyOverKm_(dist);
  });

  // 月次確定データ。SHEET_MONTHLY: [2]=site, [3]=yearMonth, [8]=billingAmount, [11]=totalKosu, [12]=totalDistance, [13]=totalOverKm
  var confirmedMap = {};
  monthlyData.slice(1).forEach(function(row) {
    if (normalizeYearMonth_(row[3]) === yearMonth) {
      var site = row[2] || '';
      confirmedMap[row[0] + '|' + site] = {
        billingAmount: sheetValueToNumber_(row[8]),
        totalKosu:     sheetValueToNumber_(row[11]),
        totalDistance: sheetValueToNumber_(row[12]),
        totalOverKm:   sheetValueToNumber_(row[13]),
      };
    }
  });

  // folderUrlが未保存の行がある場合のみDriveスキャン（全件保存済みならスキップ）
  var needsDriveScan = Object.keys(submissionMap).some(function(key) { return !submissionMap[key].folderUrl; });
  var folderUrlMap = needsDriveScan ? getMonthDriverFolderUrls_(yearMonth) : {};

  var list = Object.keys(submissionMap).map(function(key) {
    var sub = submissionMap[key];
    var d   = driverMap[key] || uidFallbackMap[sub.uid] || {};
    var wd  = workingDaysMap[key] || 0;
    var up  = d.unitPrice || 0;
    var folderName = d.site ? ((d.name || '') + '_' + d.site) : (d.name || '');
    return {
      lineUserId:     sub.uid,
      driverName:     d.name || '',
      site:           d.site || '',
      unitPrice:      up,
      fileUrl:        sub.fileUrl,
      fileType:       sub.fileType,
      status:         sub.status,
      ocrTime:        sub.ocrTime,
      workingDays:    wd,
      billingAmount:  confirmedMap[key] ? confirmedMap[key].billingAmount : wd * up,
      isConfirmed:    !!confirmedMap[key],
      totalKosu:      confirmedMap[key] ? confirmedMap[key].totalKosu     : (ocrTotalsMap[key] ? ocrTotalsMap[key].totalKosu     : 0),
      totalDistance:  confirmedMap[key] ? confirmedMap[key].totalDistance : (ocrTotalsMap[key] ? ocrTotalsMap[key].totalDistance : 0),
      totalOverKm:    confirmedMap[key] ? confirmedMap[key].totalOverKm   : (ocrTotalsMap[key] ? ocrTotalsMap[key].totalOverKm   : 0),
      folderUrl:      sub.folderUrl || folderUrlMap[folderName] || '',
      originalFileId: sub.originalFileId || '',
    };
  });

  list.sort(function(a, b) { return a.driverName.localeCompare(b.driverName, 'ja'); });
  var stats = { total: 0, pending: 0, confirmed: 0, ocrError: 0 };
  list.forEach(function(d) {
    stats.total++;
    if      (d.status === '確認待ち')  stats.pending++;
    else if (d.status === '確定')      stats.confirmed++;
    else if (d.status === 'OCRエラー') stats.ocrError++;
  });
  return jsonResponse({ drivers: list, yearMonth: yearMonth, stats: stats });
}

// ===== OCR詳細（日別データ） =====

function handleAdminGetOcrDetail_(payload) {
  var lineUserId = payload.lineUserId;
  var yearMonth  = payload.yearMonth;
  var site       = payload.site || '';
  var ss         = SpreadsheetApp.openById(getConfig_().sheetId);

  // SHEET_OCR: [0]=uid, [2]=site, [3]=yearMonth, [4]=day, [5]=start, [6]=end, [7]=isWorking, [8]=status,
  //            [9]=fixedStart, [10]=fixedEnd, [11]=fileId, [12]=uploadId,
  //            [13]=ocrKosu, [14]=ocrDistance, [15]=fixedKosu, [16]=fixedDistance
  var ocrData = ss.getSheetByName(SHEET_OCR).getDataRange().getValues();
  var days = [];
  ocrData.slice(1).forEach(function(row) {
    if (row[0] !== lineUserId || normalizeYearMonth_(row[3]) !== yearMonth || (row[2] || '') !== site) return;
    var fixedKosu     = (row[15] !== null && row[15] !== '') ? row[15] : null;
    var ocrKosu       = (row[13] !== null && row[13] !== '') ? row[13] : null;
    var fixedDistance = (row[16] !== null && row[16] !== '') ? row[16] : null;
    var ocrDistance   = (row[14] !== null && row[14] !== '') ? row[14] : null;
    var kosu          = fixedKosu     != null ? sheetValueToNumber_(fixedKosu)     : (ocrKosu     != null ? sheetValueToNumber_(ocrKosu)     : 0);
    var distance      = fixedDistance != null ? sheetValueToNumber_(fixedDistance) : (ocrDistance != null ? sheetValueToNumber_(ocrDistance) : 0);
    days.push({
      day:        row[4],
      start:      normalizeTime_(row[5]),
      end:        normalizeTime_(row[6]),
      isWorking:  row[7],
      status:     row[8],
      fixedStart: normalizeTime_(row[9]),
      fixedEnd:   normalizeTime_(row[10]),
      kosu:       kosu,
      distance:   distance,
      overKm:     calcDailyOverKm_(distance),
    });
  });
  days.sort(function(a, b) { return a.day - b.day; });

  // SHEET_RECEIVED: [1]=uid, [3]=site, [4]=yearMonth, [6]=fileId, [7]=fileUrl, [12]=noteText, [14]=folderUrl, [15]=originalFileId
  var recvData       = ss.getSheetByName(SHEET_RECEIVED).getDataRange().getValues();
  var fileUrl        = '';
  var fileId         = '';
  var noteText       = '';
  var folderUrl      = '';
  var originalFileId = '';
  recvData.slice(1).forEach(function(row) {
    if (row[1] === lineUserId && normalizeYearMonth_(row[4]) === yearMonth && (row[3] || '') === site) {
      fileUrl        = row[7];
      fileId         = row[6] || '';
      noteText       = row[12] || '';
      folderUrl      = row[14] || '';
      originalFileId = row[15] || '';
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

  var driver = getDriverByUserIdAndSite_(lineUserId, site) || {};
  // 旧データでfolderUrlが未保存の場合のみDriveスキャンで補完
  if (!folderUrl) {
    var folderUrlMap = getMonthDriverFolderUrls_(yearMonth);
    var folderName   = driver.site ? (driver.name + '_' + driver.site) : (driver.name || '');
    folderUrl        = folderUrlMap[folderName] || '';
  }

  return jsonResponse({
    days:           days,
    fileUrl:        fileUrl,
    folderUrl:      folderUrl,
    originalFileId: originalFileId,
    driver:         driver,
    yearMonth:      yearMonth,
    expenses:       expenses,
    noteText:       noteText,
    attachments:    attachments,
  });
}

// ===== OCR修正保存 =====

function handleAdminSaveCorrection_(payload, email) {
  var lineUserId  = payload.lineUserId;
  var yearMonth   = payload.yearMonth;
  var site        = payload.site || '';
  var corrections = payload.corrections; // [{ day, fixedStart, fixedEnd, fixedKosu?, fixedDistance? }]
  var silent      = !!payload.silent;   // trueのとき操作ログを記録しない（確定前の自動保存用）

  var driver     = getDriverByUserIdAndSite_(lineUserId, site);
  var driverName = driver ? driver.name : '';

  var ss    = SpreadsheetApp.openById(getConfig_().sheetId);
  var sheet = ss.getSheetByName(SHEET_OCR);
  var data  = sheet.getDataRange().getValues();

  var corrMap = {};
  corrections.forEach(function(c) { corrMap[c.day] = c; });

  var changeCount = 0;
  var changes     = []; // 日別の変更内容を収集（ログ用）
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    // SHEET_OCR: [2]=site, [3]=yearMonth, [4]=day, [5]=ocrStart, [6]=ocrEnd, [7]=isWorking(col8), [8]=status(col9), [9]=fixedStart(col10), [10]=fixedEnd(col11)
    if (row[0] !== lineUserId || normalizeYearMonth_(row[3]) !== yearMonth || (row[2] || '') !== site) continue;
    var c = corrMap[row[4]];
    if (!c) continue;
    var ocrStart      = normalizeTime_(row[5]);
    var ocrEnd        = normalizeTime_(row[6]);
    var isWorking     = c.fixedStart !== '';
    var newFixedStart = c.fixedStart !== ocrStart ? c.fixedStart : '';
    var newFixedEnd   = c.fixedEnd   !== ocrEnd   ? c.fixedEnd   : '';
    var currentFixedStart = normalizeTime_(row[9]);
    var currentFixedEnd   = normalizeTime_(row[10]);

    // 個数・走行距離の修正値決定（OCRと同値なら空=修正なし）
    var ocrKosu          = (row[13] !== null && row[13] !== '') ? sheetValueToNumber_(row[13]) : undefined;
    var ocrDistance      = (row[14] !== null && row[14] !== '') ? sheetValueToNumber_(row[14]) : undefined;
    var fk               = (c.fixedKosu     !== undefined && c.fixedKosu     !== null) ? c.fixedKosu     : undefined;
    var fd               = (c.fixedDistance !== undefined && c.fixedDistance !== null) ? c.fixedDistance : undefined;
    var newFixedKosu     = (fk !== undefined && fk !== ocrKosu)     ? fk : '';
    var newFixedDistance = (fd !== undefined && fd !== ocrDistance)  ? fd : '';

    var isChanged     = (newFixedStart !== currentFixedStart || newFixedEnd !== currentFixedEnd
                         || newFixedKosu !== (row[15] !== '' ? sheetValueToNumber_(row[15]) : '')
                         || newFixedDistance !== (row[16] !== '' ? sheetValueToNumber_(row[16]) : ''));
    var hasCorrection = (newFixedStart !== '' || newFixedEnd !== '' || newFixedKosu !== '' || newFixedDistance !== '');
    sheet.getRange(i + 1, 8).setValue(isWorking);
    if (hasCorrection) sheet.getRange(i + 1, 9).setValue('修正済み');
    sheet.getRange(i + 1, 10).setValue(newFixedStart);
    sheet.getRange(i + 1, 11).setValue(newFixedEnd);
    sheet.getRange(i + 1, 16).setValue(newFixedKosu);     // [15] fixedKosu → col16
    sheet.getRange(i + 1, 17).setValue(newFixedDistance); // [16] fixedDistance → col17
    if (isChanged) {
      changeCount++;
      changes.push({
        day:    row[4],
        before: (currentFixedStart || ocrStart) + '-' + (currentFixedEnd || ocrEnd),
        after:  (newFixedStart     || ocrStart) + '-' + (newFixedEnd     || ocrEnd),
      });
    }
  }

  SpreadsheetApp.flush();
  if (!silent && changeCount > 0) {
    var beforeLog = changes.map(function(c) { return c.day + '日 ' + c.before; }).join(', ');
    var afterLog  = changes.map(function(c) { return c.day + '日 ' + c.after;  }).join(', ');
    appendAuditLog_(email, '修正', lineUserId, driverName, yearMonth, beforeLog, afterLog, '');
  }
  return jsonResponse({ status: 'ok' });
}

// ===== 月次確定 =====

function handleAdminConfirmMonth_(payload, email) {
  var lineUserId = payload.lineUserId;
  var yearMonth  = payload.yearMonth;
  var site       = payload.site || '';
  var driver     = getDriverByUserIdAndSite_(lineUserId, site);
  if (!driver) return jsonResponse({ error: 'driver not found' });

  var ss      = SpreadsheetApp.openById(getConfig_().sheetId);
  var ocrData = ss.getSheetByName(SHEET_OCR).getDataRange().getValues();

  // SHEET_OCR: [2]=site, [3]=yearMonth, [5]=ocrStart, [6]=ocrEnd, [9]=fixedStart, [10]=fixedEnd
  //            [13]=ocrKosu, [14]=ocrDistance, [15]=fixedKosu, [16]=fixedDistance
  var workingDays   = 0;
  var totalMinutes  = 0;
  var totalKosu     = 0;
  var totalDistance = 0;
  var totalOverKm   = 0;
  ocrData.slice(1).forEach(function(row) {
    if (row[0] !== lineUserId || normalizeYearMonth_(row[3]) !== yearMonth || (row[2] || '') !== site) return;
    var startStr = normalizeTime_(row[9]) || normalizeTime_(row[5]);
    var endStr   = normalizeTime_(row[10]) || normalizeTime_(row[6]);
    if (!startStr) return;
    workingDays++;
    var s = timeToMinutes_(startStr);
    var e = timeToMinutes_(endStr);
    if (s !== null && e !== null && e > s) totalMinutes += e - s;
    var dist = (row[16] !== null && row[16] !== '') ? sheetValueToNumber_(row[16]) : sheetValueToNumber_(row[14]);
    var kosu = (row[15] !== null && row[15] !== '') ? sheetValueToNumber_(row[15]) : sheetValueToNumber_(row[13]);
    totalDistance += dist;
    totalKosu     += kosu;
    totalOverKm   += calcDailyOverKm_(dist);
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
  // 再確定の場合は旧値をログ用に読んでおく
  var beforeLog = targetRow > 0
    ? '稼働' + monthData[targetRow - 1][4] + '日/¥' + monthData[targetRow - 1][8]
    : '(新規確定)';

  var rowValues = [
    lineUserId, driver.name, site, yearMonth, workingDays,
    totalMinutes, 0, driver.unitPrice, billingAmount, new Date(), computeClosingDate_(yearMonth),
    totalKosu, totalDistance, totalOverKm
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

  appendAuditLog_(email, '確定', lineUserId, driver.name, yearMonth, beforeLog, '稼働' + workingDays + '日/¥' + billingAmount, '');
  return jsonResponse({ status: 'ok', workingDays: workingDays, billingAmount: billingAmount });
}

// ===== 締め日ヘルパー =====

// yearMonth = 'YYYY-MM'。既定は月末締め。締め日ルールは税理士確認対象でここだけ差し替える。
function computeClosingDate_(yearMonth) {
  var p = String(yearMonth).split('-');
  var y = parseInt(p[0], 10), m = parseInt(p[1], 10);
  return new Date(y, m, 0); // m月の0日 = 当月末日
}

// 既存の確定済み行に締め日を一括補完する（一回限り実行）
function backfillClosingDates_() {
  var ss    = SpreadsheetApp.openById(getConfig_().sheetId);
  var sheet = ss.getSheetByName(SHEET_MONTHLY);
  var data  = sheet.getDataRange().getValues();
  var count = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i][10]) continue; // [10]=closingDate が既に入っている行はスキップ
    var ym = normalizeYearMonth_(data[i][3]);
    if (!ym) continue;
    sheet.getRange(i + 1, 11).setValue(computeClosingDate_(ym));
    count++;
  }
  SpreadsheetApp.flush();
  Logger.log('backfillClosingDates_: ' + count + '件補完しました');
}

// ===== 集計データ出力 =====

function handleAdminExportData_(payload) {
  var yearMonth   = payload.yearMonth;
  var ss          = SpreadsheetApp.openById(getConfig_().sheetId);
  var monthlyData = ss.getSheetByName(SHEET_MONTHLY).getDataRange().getValues();

  // SHEET_MONTHLY: [1]=name, [2]=site, [3]=yearMonth, [4]=workingDays, [5]=totalMin, [7]=unitPrice, [8]=billingAmount, [9]=confirmedAt, [11]=totalKosu, [12]=totalDistance, [13]=totalOverKm
  var rows = monthlyData.slice(1)
    .filter(function(row) { return normalizeYearMonth_(row[3]) === yearMonth; })
    .map(function(row) {
      return {
        driverName:    row[1],
        site:          row[2] || '',
        yearMonth:     row[3],
        workingDays:   sheetValueToNumber_(row[4]),
        totalHours:    row[5] ? Math.round(sheetValueToNumber_(row[5]) / 60 * 10) / 10 : 0,
        unitPrice:     sheetValueToNumber_(row[7]),
        billingAmount: sheetValueToNumber_(row[8]),
        confirmedAt:   row[9] ? Utilities.formatDate(new Date(row[9]), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : '',
        totalKosu:     sheetValueToNumber_(row[11]),
        totalDistance: sheetValueToNumber_(row[12]),
        totalOverKm:   sheetValueToNumber_(row[13]),
      };
    });

  rows.sort(function(a, b) { return a.driverName.localeCompare(b.driverName, 'ja'); });
  return jsonResponse({ rows: rows, yearMonth: yearMonth });
}

// ===== ドライバーマスタ管理 =====

function handleAdminGetDriverMaster_() {
  var ss          = SpreadsheetApp.openById(getConfig_().sheetId);
  var driverData  = ss.getSheetByName(SHEET_DRIVER).getDataRange().getValues();
  var unregData   = ss.getSheetByName(SHEET_UNREGISTERED);
  var unregRows   = unregData ? unregData.getDataRange().getValues() : [[]];

  var drivers = driverData.slice(1).filter(function(row) { return !!row[0]; }).map(function(row) {
    return {
      lineUserId:      row[0],
      name:            row[1],
      site:            row[2] || '',
      unitPrice:       row[3] || 0,
      baseWorkMinutes: row[4] || 0,
      breakMinutes:    row[5] || 0,
      status:          row[6] || '稼働',
    };
  });

  var unregistered = unregRows.slice(1).filter(function(row) { return !!row[1]; }).map(function(row) {
    return {
      timestamp:   row[0] ? Utilities.formatDate(new Date(row[0]), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : '',
      lineUserId:  row[1],
      displayName: row[2] || '',
    };
  });

  return jsonResponse({ drivers: drivers, unregistered: unregistered });
}

function handleAdminSaveDriver_(payload, email) {
  var ss    = SpreadsheetApp.openById(getConfig_().sheetId);
  var sheet = ss.getSheetByName(SHEET_DRIVER);
  var data  = sheet.getDataRange().getValues();

  var uid  = payload.lineUserId || '';
  var site = payload.site || '';

  if (payload.isNew) {
    var rowValues = [uid, payload.name || '', site, payload.unitPrice || 0, payload.baseWorkMinutes || 0, payload.breakMinutes || 0, '稼働'];
    sheet.appendRow(rowValues);
    // 未登録ドライバーシートから同一UIDの行を削除
    var unregSheet = ss.getSheetByName(SHEET_UNREGISTERED);
    if (unregSheet) {
      var unregData = unregSheet.getDataRange().getValues();
      for (var r = unregData.length - 1; r >= 1; r--) {
        if (unregData[r][1] === uid) unregSheet.deleteRow(r + 1);
      }
    }
    appendAuditLog_(email, 'ドライバー追加', uid, payload.name || '', '', '', '', '');
  } else {
    // 編集は元の現場名(originalSite)で対象行を特定（現場名変更による重複行を防ぐ）
    var originalSite   = payload.originalSite || '';
    var targetRow      = -1;
    var existingStatus = '稼働';
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === uid && (data[i][2] || '') === originalSite) {
        targetRow      = i + 1;
        existingStatus = data[i][6] || '稼働';   // 稼働状態は編集で変えない
        break;
      }
    }
    var rowValuesEdit = [uid, payload.name || '', site, payload.unitPrice || 0, payload.baseWorkMinutes || 0, payload.breakMinutes || 0, existingStatus];
    if (targetRow > 0) {
      sheet.getRange(targetRow, 1, 1, rowValuesEdit.length).setValues([rowValuesEdit]);
    } else {
      sheet.appendRow(rowValuesEdit);
    }
    appendAuditLog_(email, 'ドライバー編集', uid, payload.name || '', '', '', '', '');
  }

  return jsonResponse({ status: 'ok' });
}

function handleAdminSetDriverStatus_(payload, email) {
  var ss    = SpreadsheetApp.openById(getConfig_().sheetId);
  var sheet = ss.getSheetByName(SHEET_DRIVER);
  var data  = sheet.getDataRange().getValues();

  var uid        = payload.lineUserId || '';
  var site       = payload.site || '';
  var status     = payload.status === '停止' ? '停止' : '稼働';
  var driverName = '';

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === uid && (data[i][2] || '') === site) {
      driverName = data[i][1];
      sheet.getRange(i + 1, 7, 1, 1).setValues([[status]]);
      break;
    }
  }

  appendAuditLog_(email, status === '停止' ? '稼働停止' : '稼働再開', uid, driverName, '', '', '', '');
  return jsonResponse({ status: 'ok' });
}

function handleAdminDeleteUnregistered_(payload, email) {
  var ss    = SpreadsheetApp.openById(getConfig_().sheetId);
  var sheet = ss.getSheetByName(SHEET_UNREGISTERED);
  var uid   = payload.lineUserId || '';

  if (sheet) {
    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (data[i][1] === uid) sheet.deleteRow(i + 1);
    }
  }

  appendAuditLog_(email, '未登録削除', uid, '', '', '', '', '');
  return jsonResponse({ status: 'ok' });
}

function handleAdminDeleteDriver_(payload, email) {
  var ss    = SpreadsheetApp.openById(getConfig_().sheetId);
  var sheet = ss.getSheetByName(SHEET_DRIVER);
  var data  = sheet.getDataRange().getValues();

  var uid        = payload.lineUserId || '';
  var site       = payload.site || '';
  var driverName = '';

  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === uid && (data[i][2] || '') === site) {
      driverName = data[i][1];
      sheet.deleteRow(i + 1);
      break;
    }
  }

  appendAuditLog_(email, 'ドライバー削除', uid, driverName, '', '', '', '');
  return jsonResponse({ status: 'ok' });
}

// ===== 操作ログ =====

function appendAuditLog_(email, action, lineUserId, driverName, yearMonth, before, after, note) {
  try {
    var sheet = SpreadsheetApp.openById(getConfig_().sheetId).getSheetByName(SHEET_LOG);
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
    var rootFolder = DriveApp.getFolderById(getConfig_().folderId);
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

// ===== 超過km計算ヘルパー =====

var OVER_KM_THRESHOLD_ = 100; // 日別超過km閾値（定数化して運用調整可）

function calcDailyOverKm_(distance) {
  return Math.max(0, (distance || 0) - OVER_KM_THRESHOLD_);
}

// ===== 数値変換ヘルパー =====

// Sheets が数値セルを Date 型で返すことがある（シリアル番号 → 日付自動変換）ため数値に戻す
// Sheets エポック: 1899-12-30
function sheetValueToNumber_(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  if (val instanceof Date) {
    return Math.round((val.getTime() - new Date(1899, 11, 30).getTime()) / 86400000);
  }
  return Number(val) || 0;
}

