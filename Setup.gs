// 初回セットアップ用。実行後は削除してOK。

function setupSheets() {
  var ss = SpreadsheetApp.openById(SHEET_ID);

  var schemas = [
    {
      name: SHEET_RECEIVED,
      headers: ['タイムスタンプ', 'LINEユーザーID', 'ドライバー名', '年月', 'ファイル種別', 'DriveファイルID', 'DriveURL', 'ステータス', 'OCR実行日時', '同意', '同意日時', '備考テキスト', 'アップロードID']
    },
    {
      name: SHEET_OCR,
      headers: ['LINEユーザーID', 'ドライバー名', '年月', '日', '開始時間', '終了時間', '稼働フラグ', '確認ステータス', '修正後開始時間', '修正後終了時間', '受信ファイルID', 'アップロードID']
    },
    {
      name: SHEET_DRIVER,
      headers: ['LINEユーザーID', 'ドライバー名', '現場名', '単価(税別)', '基準拘束時間(分)', '休憩時間(分)']
    },
    {
      name: SHEET_MONTHLY,
      headers: ['LINEユーザーID', 'ドライバー名', '年月', '稼働日数', '実働時間合計(分)', '超過時間合計(分)', '単価', '請求金額', '確定日時']
    },
    {
      name: SHEET_EXPENSE,
      headers: ['LINEユーザーID', 'ドライバー名', '年月', '行番号', '区分', '金額', '内容', '確認ステータス', '受信ファイルID', 'アップロードID']
    },
    {
      name: SHEET_ATTACHMENT,
      headers: ['タイムスタンプ', 'LINEユーザーID', 'ドライバー名', '年月', 'インデックス', 'ファイル名', 'DriveファイルID', 'DriveURL', 'アップロードID']
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
  var ss = SpreadsheetApp.openById(SHEET_ID);

  // SHEET_RECEIVED から (lineUserId|yearMonth) → uploadId のマップを構築
  var recvData = ss.getSheetByName(SHEET_RECEIVED).getDataRange().getValues();
  var uidMap = {};
  recvData.slice(1).forEach(function(row) {
    var uid      = row[1];
    var ym       = normalizeYearMonth_(row[3]);
    var uploadId = row[12]; // アップロードID
    if (uid && ym && uploadId) uidMap[uid + '|' + ym] = uploadId;
  });

  var updated = { ocr: 0, expense: 0 };

  // SHEET_OCR の [11] が空の行を更新
  var ocrSheet = ss.getSheetByName(SHEET_OCR);
  var ocrData  = ocrSheet.getDataRange().getValues();
  for (var i = 1; i < ocrData.length; i++) {
    if (ocrData[i][11]) continue;
    var ocrUid = uidMap[ocrData[i][0] + '|' + normalizeYearMonth_(ocrData[i][2])];
    if (ocrUid) { ocrSheet.getRange(i + 1, 12).setValue(ocrUid); updated.ocr++; }
  }

  // SHEET_EXPENSE の [9] が空の行を更新
  var expSheet = ss.getSheetByName(SHEET_EXPENSE);
  if (expSheet) {
    var expData = expSheet.getDataRange().getValues();
    for (var j = 1; j < expData.length; j++) {
      if (expData[j][9]) continue;
      var expUid = uidMap[expData[j][0] + '|' + normalizeYearMonth_(expData[j][2])];
      if (expUid) { expSheet.getRange(j + 1, 10).setValue(expUid); updated.expense++; }
    }
  }

  SpreadsheetApp.flush();
  Logger.log('バックフィル完了: OCR ' + updated.ocr + '件, 立替 ' + updated.expense + '件');
}
