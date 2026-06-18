// ===== 定数 =====
var SHEET_ID        = '1vPSbmyEUov0-hasJ9YVqggt2ClP9Blx8Do1zqlb8chc';
var DRIVE_FOLDER_ID = '1T9j-k7DY5DGwscHQQlhIkEEE4uggQGXR';

var SHEET_RECEIVED = '月報受信ファイル';
var SHEET_OCR      = 'OCR結果データ';
var SHEET_DRIVER   = 'ドライバーマスタ';
var SHEET_MONTHLY  = '月次確定';
var SHEET_EXPENSE      = '立替明細';
var SHEET_ATTACHMENT   = '添付ファイル';
var SHEET_LOG          = '操作ログ';
var SHEET_UNREGISTERED = '未登録ドライバー';

// ===== ルーティング =====

function doGet(e) {
  var action = (e.parameter && e.parameter.action) || '';
  switch (action) {
    case 'health':
      return jsonResponse({ status: 'ok', ts: new Date().toISOString() });
    default:
      return jsonResponse({ error: 'invalid action' });
  }
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var action  = payload.action || '';
    switch (action) {
      case 'bootstrap':     return handleBootstrap(payload);
      case 'getProfile':    return handleGetProfile(payload);
      case 'uploadReport':     return handleUploadReport(payload);
      case 'uploadAttachment': return handleUploadAttachment(payload);
      case 'getMyReports':     return handleGetMyReports(payload);
      case 'adminGetOverview':
      case 'adminGetDriverList':
      case 'adminGetOcrDetail':
      case 'adminSaveCorrection':
      case 'adminConfirmMonth':
      case 'adminExportData':
        return handleAdminPost(payload);
      default:
        return jsonResponse({ error: 'invalid action' });
    }
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ===== ドライバー向けAPI =====

// 起動時に1回のリクエストでプロフィール＋提出履歴を返す
function handleBootstrap(payload) {
  var drivers = getDriversByUserId_(payload.lineUserId);
  if (!drivers.length) {
    saveUnregisteredDriver_(payload.lineUserId, payload.displayName || '');
    return jsonResponse({ error: 'unauthorized' });
  }

  var reports = getReportsByUserId_(drivers[0].lineUserId);
  return jsonResponse({
    drivers: drivers,
    reports: reports,
  });
}

function saveUnregisteredDriver_(lineUserId, displayName) {
  if (!lineUserId) return;
  try {
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_UNREGISTERED);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_UNREGISTERED);
      sheet.getRange(1, 1, 1, 3).setValues([['タイムスタンプ', 'LINEユーザーID', '表示名']]);
      sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#e8f0fe');
    }
    sheet.appendRow([new Date(), lineUserId, displayName]);
  } catch (e) {
    Logger.log('saveUnregisteredDriver_ error: ' + e.message);
  }
}

function handleGetProfile(payload) {
  var driver = getDriverByUserId(payload.lineUserId);
  if (!driver) return jsonResponse({ error: 'unauthorized' });
  return jsonResponse({ driver: driver });
}

function handleUploadReport(payload) {
  var driver = getDriverByUserIdAndSite_(payload.lineUserId, payload.site || '');
  if (!driver) return jsonResponse({ error: 'unauthorized' });

  var yearMonth = payload.yearMonth;
  var site      = driver.site || '';
  var mimeType  = payload.mimeType || 'image/jpeg';
  var base64    = payload.fileBase64;
  var uploadId  = payload.uploadId || '';
  var origName  = payload.fileName || ('report_' + yearMonth);
  var fileName  = uploadId ? (uploadId + '_' + origName) : origName;
  var fileType  = mimeType === 'application/pdf' ? 'pdf' : 'image';

  // Drive に保存
  var driveResult = saveFileToDrive_(driver, yearMonth, mimeType, base64, fileName);
  var fileId      = driveResult.fileId;
  var fileUrl     = 'https://drive.google.com/file/d/' + fileId + '/view';
  var folderUrl   = 'https://drive.google.com/drive/folders/' + driveResult.folderId;

  var ss = SpreadsheetApp.openById(SHEET_ID);

  // 同一人・同一月・同一現場の既存受信行を削除（Driveファイルごと）
  // SHEET_RECEIVED: [1]=uid, [3]=site, [4]=yearMonth, [6]=fileId
  var recvSheet = ss.getSheetByName(SHEET_RECEIVED);
  var recvData  = recvSheet.getDataRange().getValues();
  for (var i = recvData.length - 1; i >= 1; i--) {
    if (recvData[i][1] === driver.lineUserId &&
        normalizeYearMonth_(recvData[i][4]) === yearMonth &&
        (recvData[i][3] || '') === site) {
      trashDriveFile_(recvData[i][6]); // [6] = DriveファイルID
      recvSheet.deleteRow(i + 1);
    }
  }

  // 同一人・同一月・同一現場の既存添付行を削除（Driveファイルごと）
  // SHEET_ATTACHMENT: [1]=uid, [3]=site, [4]=yearMonth, [7]=fileId
  var attSheet = ss.getSheetByName(SHEET_ATTACHMENT);
  if (attSheet) {
    var attData = attSheet.getDataRange().getValues();
    for (var j = attData.length - 1; j >= 1; j--) {
      if (attData[j][1] === driver.lineUserId &&
          normalizeYearMonth_(attData[j][4]) === yearMonth &&
          (attData[j][3] || '') === site) {
        trashDriveFile_(attData[j][7]); // [7] = DriveファイルID
        attSheet.deleteRow(j + 1);
      }
    }
  }

  recvSheet.appendRow([
    new Date(),                    // [0]  タイムスタンプ
    driver.lineUserId,             // [1]  LINEユーザーID
    driver.name,                   // [2]  ドライバー名
    site,                          // [3]  現場名
    yearMonth,                     // [4]  年月
    fileType,                      // [5]  ファイル種別
    fileId,                        // [6]  DriveファイルID
    fileUrl,                       // [7]  DriveURL
    '未処理',                       // [8]  ステータス
    '',                            // [9]  OCR実行日時
    payload.consent ? '同意' : '', // [10] 同意
    formatConsentAt_(payload.consentAt), // [11] 同意日時
    '',                            // [12] 備考テキスト（OCR後に更新）
    uploadId,                      // [13] アップロードID
    folderUrl,                     // [14] フォルダURL
  ]);

  // OCR実行（失敗してもアップロード自体は成功扱い）
  var ocrResult = null;
  try {
    if (fileType === 'pdf') {
      ocrResult = runOcr(fileId, yearMonth, driver.lineUserId, null, null, base64, uploadId, site);
    } else {
      var firstBase64  = payload.fileBase64First  || base64;
      var secondBase64 = payload.fileBase64Second || base64;
      ocrResult = runOcr(fileId, yearMonth, driver.lineUserId, firstBase64, secondBase64, null, uploadId, site);
    }
  } catch (ocrErr) {
    Logger.log('OCR error: ' + ocrErr.message);
  }

  return jsonResponse({
    status:      'ok',
    fileId:      fileId,
    fileUrl:     fileUrl,
    workingDays: ocrResult ? ocrResult.workingDays : null,
  });
}

function handleUploadAttachment(payload) {
  var driver = getDriverByUserIdAndSite_(payload.lineUserId, payload.site || '');
  if (!driver) return jsonResponse({ error: 'unauthorized' });

  var yearMonth = payload.yearMonth;
  var site      = driver.site || '';
  var mimeType  = payload.mimeType || 'image/jpeg';
  var base64    = payload.fileBase64;
  var uploadId  = payload.uploadId || '';
  var origName  = payload.fileName || ('att_' + (payload.index + 1));
  var fileName  = uploadId
    ? (uploadId + '_添付' + (payload.index + 1) + '_' + origName)
    : origName;

  var driveResult = saveFileToDrive_(driver, yearMonth, mimeType, base64, fileName);
  var fileId  = driveResult.fileId;
  var fileUrl = 'https://drive.google.com/file/d/' + fileId + '/view';

  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_ATTACHMENT);
  sheet.appendRow([
    new Date(),         // [0] タイムスタンプ
    driver.lineUserId,  // [1] LINEユーザーID
    driver.name,        // [2] ドライバー名
    site,               // [3] 現場名
    yearMonth,          // [4] 年月
    payload.index || 0, // [5] インデックス
    origName,           // [6] 元ファイル名
    fileId,             // [7] DriveファイルID
    fileUrl,            // [8] DriveURL
    uploadId,           // [9] アップロードID
  ]);

  return jsonResponse({ status: 'ok', fileId: fileId, fileUrl: fileUrl });
}

function handleGetMyReports(payload) {
  var drivers = getDriversByUserId_(payload.lineUserId);
  if (!drivers.length) return jsonResponse({ error: 'unauthorized' });
  return jsonResponse({ reports: getReportsByUserId_(drivers[0].lineUserId) });
}

// ===== ヘルパー =====

function getDriverByUserId(userId) {
  if (!userId) return null;
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_DRIVER);
  var data  = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === userId) {
      return {
        lineUserId:      data[i][0],
        name:            data[i][1],
        site:            data[i][2],
        unitPrice:       data[i][3],
        baseWorkMinutes: data[i][4],
      };
    }
  }
  return null;
}

// userId の全現場分を配列で返す
function getDriversByUserId_(userId) {
  if (!userId) return [];
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_DRIVER);
  var data  = sheet.getDataRange().getValues();

  var drivers = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === userId) {
      drivers.push({
        lineUserId:      data[i][0],
        name:            data[i][1],
        site:            data[i][2],
        unitPrice:       data[i][3],
        baseWorkMinutes: data[i][4],
      });
    }
  }
  return drivers;
}

// userId + site で1件取得。site が空のときは最初のマッチを返す（後方互換）
function getDriverByUserIdAndSite_(userId, site) {
  if (!userId) return null;
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_DRIVER);
  var data  = sheet.getDataRange().getValues();

  var firstMatch = null;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === userId) {
      if (!firstMatch) firstMatch = data[i];
      if ((data[i][2] || '') === (site || '')) {
        return {
          lineUserId:      data[i][0],
          name:            data[i][1],
          site:            data[i][2],
          unitPrice:       data[i][3],
          baseWorkMinutes: data[i][4],
        };
      }
    }
  }
  // site 未指定のとき最初のマッチを返す（旧クライアント互換）
  if (!site && firstMatch) {
    return {
      lineUserId:      firstMatch[0],
      name:            firstMatch[1],
      site:            firstMatch[2],
      unitPrice:       firstMatch[3],
      baseWorkMinutes: firstMatch[4],
    };
  }
  return null;
}

function getReportsByUserId_(lineUserId) {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_RECEIVED);
  var data  = sheet.getDataRange().getValues();

  // SHEET_RECEIVED: [1]=uid, [3]=site, [4]=yearMonth, [5]=fileType, [7]=fileUrl, [8]=status
  var reports = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] === lineUserId) {
      reports.push({
        timestamp: data[i][0] ? new Date(data[i][0]).toISOString() : '',
        yearMonth: normalizeYearMonth_(data[i][4]),
        fileType:  data[i][5],
        fileUrl:   data[i][7],
        status:    data[i][8],
        site:      data[i][3] || '',
      });
    }
  }
  return reports;
}

function saveFileToDrive_(driver, yearMonth, mimeType, base64, fileName) {
  var blob = Utilities.newBlob(
    Utilities.base64Decode(base64),
    mimeType,
    fileName
  );

  var rootFolder   = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  var monthFolder  = getOrCreateFolder_(rootFolder, yearMonth);
  var folderName   = driver.site ? (driver.name + '_' + driver.site) : driver.name;
  var driverFolder = getOrCreateFolder_(monthFolder, folderName);

  return {
    fileId:   driverFolder.createFile(blob).getId(),
    folderId: driverFolder.getId(),
  };
}

function trashDriveFile_(fileId) {
  try {
    if (fileId) DriveApp.getFileById(fileId).setTrashed(true);
  } catch (e) {
    Logger.log('trashDriveFile_ error: ' + fileId + ' / ' + e.message);
  }
}

function getOrCreateFolder_(parent, name) {
  var iter = parent.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return parent.createFolder(name);
}

function formatConsentAt_(isoStr) {
  if (!isoStr) return '';
  try {
    return Utilities.formatDate(new Date(isoStr), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  } catch (e) {
    return isoStr;
  }
}

function jsonResponse(data) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
