// 初回セットアップ用。実行後は削除してOK。

function setupSheets() {
  var ss = SpreadsheetApp.openById(getConfig_().sheetId);

  // 立替明細の「確認ステータス」列を物理削除（廃止列）
  var expSheetPre = ss.getSheetByName(SHEET_EXPENSE);
  if (expSheetPre && expSheetPre.getLastColumn() > 0) {
    var expHeaders = expSheetPre.getRange(1, 1, 1, expSheetPre.getLastColumn()).getValues()[0];
    var statusColIdx = expHeaders.indexOf('確認ステータス');
    if (statusColIdx !== -1) {
      expSheetPre.deleteColumn(statusColIdx + 1);
      Logger.log('確認ステータス列を削除しました（列' + (statusColIdx + 1) + '）');
    }
  }

  var schemas = [
    {
      name: SHEET_RECEIVED,
      // [0]timestamp [1]uid [2]name [3]site [4]yearMonth [5]fileType [6]fileId [7]fileUrl [8]status [9]ocrTime [10]consent [11]consentAt [12]noteText [13]uploadId [14]folderUrl [15]originalFileId
      headers: ['タイムスタンプ', 'LINEユーザーID', 'ドライバー名', '現場名', '年月', 'ファイル種別', 'DriveファイルID', 'DriveURL', 'ステータス', 'OCR実行日時', '同意', '同意日時', '備考テキスト', 'アップロードID', 'フォルダURL', '原本ファイルID']
    },
    {
      name: SHEET_OCR,
      // [0]uid [1]name [2]site [3]yearMonth [4]day [5]start [6]end [7]isWorking [8]status [9]fixedStart [10]fixedEnd [11]fileId [12]uploadId
      headers: ['LINEユーザーID', 'ドライバー名', '現場名', '年月', '日', '開始時間', '終了時間', '稼働フラグ', '確認ステータス', '修正後開始時間', '修正後終了時間', '受信ファイルID', 'アップロードID']
    },
    {
      name: SHEET_DRIVER,
      headers: ['LINEユーザーID', 'ドライバー名', '現場名', '単価(税別)', '基準拘束時間(分)', '休憩時間(分)', '稼働状態']
    },
    {
      name: SHEET_MONTHLY,
      // [0]uid [1]name [2]site [3]yearMonth [4]workingDays [5]totalMin [6]overMin [7]unitPrice [8]billingAmount [9]confirmedAt [10]closingDate
      headers: ['LINEユーザーID', 'ドライバー名', '現場名', '年月', '稼働日数', '実働時間合計(分)', '超過時間合計(分)', '単価', '請求金額', '確定日時', '取引年月日(締め日)']
    },
    {
      name: SHEET_EXPENSE,
      // [0]uid [1]name [2]site [3]yearMonth [4]row# [5]category [6]amount [7]note [8]fileId [9]uploadId
      headers: ['LINEユーザーID', 'ドライバー名', '現場名', '年月', '行番号', '区分', '金額', '内容', '受信ファイルID', 'アップロードID']
    },
    {
      name: SHEET_ATTACHMENT,
      // [0]timestamp [1]uid [2]name [3]site [4]yearMonth [5]index [6]fileName [7]fileId [8]fileUrl [9]uploadId
      headers: ['タイムスタンプ', 'LINEユーザーID', 'ドライバー名', '現場名', '年月', 'インデックス', 'ファイル名', 'DriveファイルID', 'DriveURL', 'アップロードID']
    },
    {
      name: SHEET_LOG,
      // [0]timestamp [1]email [2]action [3]uid [4]name [5]yearMonth [6]before [7]after [8]note
      headers: ['日時', '操作者メール', '操作種別', 'LINEユーザーID', 'ドライバー名', '年月', '変更前', '変更後', '補足']
    },
    {
      name: SHEET_UNREGISTERED,
      // [0]timestamp [1]uid [2]displayName
      headers: ['タイムスタンプ', 'LINEユーザーID', '表示名']
    }
  ];

  schemas.forEach(function(schema) {
    var sheet = ss.getSheetByName(schema.name);
    if (!sheet) {
      sheet = ss.insertSheet(schema.name);
    }
    sheet.getRange(1, 1, 1, schema.headers.length).setValues([schema.headers]);
    sheet.getRange(1, 1, 1, schema.headers.length)
      .setFontWeight('bold')
      .setBackground('#e8f0fe');
  });

  // デフォルトの「シート1」を削除
  var defaultSheet = ss.getSheetByName('シート1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  Logger.log('シート作成完了: ' + schemas.map(function(s){ return s.name; }).join(', '));
}

// アップロードIDを既存OCR・立替明細行に紐づける（一回限りのバックフィル）
function backfillUploadIds() {
  var ss = SpreadsheetApp.openById(getConfig_().sheetId);

  // SHEET_RECEIVED から (lineUserId|yearMonth) → uploadId のマップを構築
  // SHEET_RECEIVED: [1]=uid, [4]=yearMonth, [13]=uploadId
  var recvData = ss.getSheetByName(SHEET_RECEIVED).getDataRange().getValues();
  var uidMap = {};
  recvData.slice(1).forEach(function(row) {
    var uid      = row[1];
    var ym       = normalizeYearMonth_(row[4]);
    var uploadId = row[13]; // アップロードID
    if (uid && ym && uploadId) uidMap[uid + '|' + ym] = uploadId;
  });

  var updated = { ocr: 0, expense: 0 };

  // SHEET_OCR: [12]=uploadId, [0]=uid, [3]=yearMonth
  var ocrSheet = ss.getSheetByName(SHEET_OCR);
  var ocrData  = ocrSheet.getDataRange().getValues();
  for (var i = 1; i < ocrData.length; i++) {
    if (ocrData[i][12]) continue;
    var ocrUid = uidMap[ocrData[i][0] + '|' + normalizeYearMonth_(ocrData[i][3])];
    if (ocrUid) { ocrSheet.getRange(i + 1, 13).setValue(ocrUid); updated.ocr++; }
  }

  // SHEET_EXPENSE: [9]=uploadId, [0]=uid, [3]=yearMonth
  var expSheet = ss.getSheetByName(SHEET_EXPENSE);
  if (expSheet) {
    var expData = expSheet.getDataRange().getValues();
    for (var j = 1; j < expData.length; j++) {
      if (expData[j][9]) continue;
      var expUid = uidMap[expData[j][0] + '|' + normalizeYearMonth_(expData[j][3])];
      if (expUid) { expSheet.getRange(j + 1, 10).setValue(expUid); updated.expense++; }
    }
  }

  SpreadsheetApp.flush();
  Logger.log('バックフィル完了: OCR ' + updated.ocr + '件, 立替 ' + updated.expense + '件');
}
