// Claude API を使った月報OCRサービス
// Script Properties に CLAUDE_API_KEY・CLAUDE_MODEL を設定しておくこと

var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
var CLAUDE_MODEL   = PropertiesService.getScriptProperties().getProperty('CLAUDE_MODEL') || 'claude-sonnet-4-6';

var OCR_PROMPT_DAYS = [
  'これはドライバーの月次稼働報告書の画像です。',
  '日付ごとに「開始時間」「終了時間」を読み取り、',
  '次のJSON形式のみで返してください。',
  '',
  '{"days":[{"day":1,"start":"08:00","end":"17:30"}, ...]}',
  '',
  '- day: 帳票の日付の数字（1〜31の整数）',
  '- start/end: HH:MM。記入なしはnull',
  '- 合計行・集計欄・立替欄・備考欄は読まない',
  '- JSONブロックのみを返し説明文は不要',
  '',
  '【手書き数字の混同に注意】',
  '- 1 と 7: 1は縦線のみ。7は頂部に横棒がある（欧風では中央にも横棒が入ることがある）',
  '- 7 と 9: 9と読むには上部に完全に閉じた丸（○）が明確に見えることが必要。丸が小さい・開いている・不明瞭な場合は 7 と読む。「17時 vs 19時」「分の末尾 :X7 vs :X9」は特に注意',
  '- 0 と 6: 0は完全に閉じた楕円。6は上が開いていて下部に丸がある',
  '- 0 と 8: 0は単純な1つの楕円。8は上下に2つの丸が重なる',
  '- 3 と 8: 3は右向きに開いた2つの弧。8は閉じた2つの丸',
].join('\n');

var OCR_PROMPT_META = [
  '下部の「立替経費」欄と「備考」欄だけを読み取り、次のJSON形式のみで返してください。',
  '',
  '{"expenses":[{"category":"高速代","amount":1200,"note":"○○IC"}],"hasNote":true,"noteText":"特記事項のテキスト"}',
  '',
  '- category: 塗られた区分（高速代／燃料代／駐車場／その他 のいずれか）',
  '- amount: 金額の整数（円）。読めなければnull',
  '- note: その行に書かれた補足テキスト（経由地・店名・「その他」の内容など）。なければnull',
  '- 区分も金額もない空行は配列に含めない',
  '- hasNote: 備考欄に記載があればtrue',
  '- noteText: 備考欄の記載内容テキスト。hasNoteがtrueのときに内容を入れる。なければnull',
  '- JSONブロックのみを返し説明文は不要',
].join('\n');

var OCR_PROMPT_VALIDATION = [
  'この画像（またはPDF）が月次稼働報告書（月報）であるかどうかを判定してください。',
  '',
  '次のJSON形式のみで返してください:',
  '{"isReport":true,"canRead":true,"reason":null}',
  '',
  '- isReport: 日別稼働時間を記録した月次帳票であればtrue。レシート・名刺・無関係な書類などはfalse',
  '- canRead: 文字が判読できる状態であればtrue。真っ暗・ピンぼけ・白飛びなど内容が読み取れない場合はfalse',
  '- reason: isReport=falseまたはcanRead=falseのとき、理由を日本語で簡潔に（例: "レシートの写真です"）。問題なければnull',
  '- JSONブロックのみを返し説明文は不要',
].join('\n');

// base64/mimeType の画像またはPDFが月報かつ判読可能かを軽量判定。
// 失敗時は { isReport:true, canRead:true, reason:null } にフォールバック（提出ブロックを避ける）。
function runReportValidation_(base64, mimeType) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) return { isReport: true, canRead: true, reason: null };
  try {
    var results = callClaudeApiBatch_(apiKey, [
      { base64: base64, mimeType: mimeType || 'image/jpeg', prompt: OCR_PROMPT_VALIDATION },
    ]);
    return parseValidationResult_(results[0]);
  } catch (e) {
    Logger.log('runReportValidation_ error: ' + e.message);
    return { isReport: true, canRead: true, reason: null };
  }
}

function parseValidationResult_(text) {
  var match = text.match(/\{[\s\S]*?\}/);
  if (!match) return { isReport: true, canRead: true, reason: null };
  try {
    var parsed = JSON.parse(match[0]);
    return {
      isReport: parsed.isReport !== false,
      canRead:  parsed.canRead  !== false,
      reason:   parsed.reason   || null,
    };
  } catch (e) {
    return { isReport: true, canRead: true, reason: null };
  }
}

// ===== メイン関数 =====

// Code.gsのhandleUploadReportから呼ばれる
function runOcr(fileId, yearMonth, lineUserId, firstBase64, secondBase64, pdfBase64, uploadId, site) {
  var driver = getDriverByUserIdAndSite_(lineUserId, site || '');
  if (!driver) throw new Error('Driver not found: ' + lineUserId);

  var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set in Script Properties');

  updateReceivedFileStatus_(fileId, 'OCR中');

  try {
    var days;
    var hasNote  = false;
    var expenses = [];
    var noteText = '';

    if (pdfBase64) {
      // PDF: DAYS と META を並行実行
      var results = callClaudeApiBatch_(apiKey, [
        { base64: pdfBase64, mimeType: 'application/pdf', prompt: OCR_PROMPT_DAYS },
        { base64: pdfBase64, mimeType: 'application/pdf', prompt: OCR_PROMPT_META },
      ]);
      var daysResult = parseDaysResult_(results[0]);
      var metaResult = parseMetaResult_(results[1]);
      days     = daysResult.days;
      hasNote  = metaResult.hasNote;
      expenses = metaResult.expenses;
      noteText = metaResult.noteText;
    } else {
      // 画像: 前半DAYS・後半DAYS・後半METAを同時並行（3リクエスト一括）
      var promptFirst  = OCR_PROMPT_DAYS + '\n\n【補足】これは月報の前半部分の画像です。';
      var promptSecond = OCR_PROMPT_DAYS + '\n\n【補足】これは月報の後半部分の画像です。';
      var results = callClaudeApiBatch_(apiKey, [
        { base64: firstBase64,  mimeType: 'image/jpeg', prompt: promptFirst },
        { base64: secondBase64, mimeType: 'image/jpeg', prompt: promptSecond },
        { base64: secondBase64, mimeType: 'image/jpeg', prompt: OCR_PROMPT_META },
      ]);
      var firstResult  = parseDaysResult_(results[0]);
      var secondResult = parseDaysResult_(results[1]);
      days     = mergeHalves_(firstResult.days, secondResult.days);
      var metaResult = parseMetaResult_(results[2]);
      hasNote  = metaResult.hasNote;
      expenses = metaResult.expenses;
      noteText = metaResult.noteText;
    }

    writeOcrResults_(lineUserId, driver.name, yearMonth, fileId, days, uploadId, site || '');
    if (expenses.length > 0) {
      saveExpenseRows_(lineUserId, driver.name, yearMonth, fileId, expenses, uploadId, site || '');
    }
    finalizeReceivedRow_(fileId, '確認待ち', noteText);

    return { workingDays: countWorkingDays_(days), days: days };

  } catch (err) {
    updateReceivedFileStatus_(fileId, 'OCRエラー');
    throw err;
  }
}

// ===== Claude API呼び出し =====

function buildClaudeRequest_(base64, mimeType, prompt, apiKey) {
  var contentItem = mimeType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image',    source: { type: 'base64', media_type: mimeType,           data: base64 } };

  return {
    url:    CLAUDE_API_URL,
    method: 'post',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    payload: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: [contentItem, { type: 'text', text: prompt }] }],
    }),
    muteHttpExceptions: true,
  };
}

// requests: [{base64, mimeType, prompt}, ...]  → 全件を fetchAll で並行実行し、レスポンステキスト配列を返す
function callClaudeApiBatch_(apiKey, requests) {
  var fetchReqs = requests.map(function(r) {
    return buildClaudeRequest_(r.base64, r.mimeType, r.prompt, apiKey);
  });
  var responses = UrlFetchApp.fetchAll(fetchReqs);
  return responses.map(function(res, i) {
    var json = JSON.parse(res.getContentText());
    if (json.error) throw new Error('Claude API error[' + i + ']: ' + json.error.message);
    return json.content[0].text;
  });
}

// ===== パース・マージ =====

function parseDaysResult_(text) {
  var match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('OCRレスポンスからJSONを取得できませんでした: ' + text.substring(0, 200));
  var parsed = JSON.parse(match[0]);
  return { days: parsed.days || [] };
}

function parseMetaResult_(text) {
  var match = text.match(/\{[\s\S]*\}/);
  if (!match) return { expenses: [], hasNote: false, noteText: '' };
  try {
    var parsed = JSON.parse(match[0]);
    return {
      expenses: parsed.expenses || [],
      hasNote:  !!parsed.hasNote,
      noteText: parsed.noteText || '',
    };
  } catch (e) {
    return { expenses: [], hasNote: false, noteText: '' };
  }
}

function mergeHalves_(leftDays, rightDays) {
  var map = {};

  // 両方の結果をマージ。同じ日は start が非nullの方を優先
  leftDays.concat(rightDays).forEach(function(d) {
    if (!map[d.day] || (d.start !== null && map[d.day].start === null)) {
      map[d.day] = d;
    }
  });

  var result = [];
  for (var day = 1; day <= 31; day++) {
    if (map[day]) result.push(map[day]);
  }
  return result;
}

// 稼働日数 = 開始時間が記入されている日の数（APIサマリ値は使用しない）
function countWorkingDays_(days) {
  return days.filter(function(d) { return d.start !== null; }).length;
}

// ===== Sheets書き込み =====

function writeOcrResults_(lineUserId, driverName, yearMonth, fileId, days, uploadId, site) {
  var ss    = SpreadsheetApp.openById(getConfig_().sheetId);
  var sheet = ss.getSheetByName(SHEET_OCR);

  // 同じ lineUserId + yearMonth + site の既存行を削除
  // SHEET_OCR: [0]=uid, [2]=site, [3]=yearMonth
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === lineUserId &&
        normalizeYearMonth_(data[i][3]) === yearMonth &&
        (data[i][2] || '') === (site || '')) {
      sheet.deleteRow(i + 1);
    }
  }

  if (days.length === 0) return;

  var rows = days.map(function(d) {
    var hasStartTime = d.start !== null && d.start !== undefined && d.start !== '';
    return [
      lineUserId,        // [0]  LINEユーザーID
      driverName,        // [1]  ドライバー名
      site || '',        // [2]  現場名
      yearMonth,         // [3]  年月
      d.day,             // [4]  日
      d.start || '',     // [5]  開始時間
      d.end   || '',     // [6]  終了時間
      hasStartTime,      // [7]  稼働フラグ
      '未確認',           // [8]  確認ステータス
      '',                // [9]  修正後開始時間
      '',                // [10] 修正後終了時間
      fileId,            // [11] 受信ファイルID
      uploadId || '',    // [12] アップロードID
    ];
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function saveExpenseRows_(lineUserId, driverName, yearMonth, fileId, expenses, uploadId, site) {
  var ss    = SpreadsheetApp.openById(getConfig_().sheetId);
  var sheet = ss.getSheetByName(SHEET_EXPENSE);
  if (!sheet) return;

  // 同じ lineUserId + yearMonth + site の既存立替行を削除
  // SHEET_EXPENSE: [0]=uid, [2]=site, [3]=yearMonth
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === lineUserId &&
        normalizeYearMonth_(data[i][3]) === yearMonth &&
        (data[i][2] || '') === (site || '')) {
      sheet.deleteRow(i + 1);
    }
  }

  var rows = expenses.map(function(exp, idx) {
    return [
      lineUserId,           // [0] LINEユーザーID
      driverName,           // [1] ドライバー名
      site || '',           // [2] 現場名
      yearMonth,            // [3] 年月
      idx + 1,              // [4] 行番号
      exp.category || '',   // [5] 区分
      exp.amount   !== null && exp.amount !== undefined ? exp.amount : '', // [6] 金額
      exp.note     || '',   // [7] 内容
      fileId,               // [8] 受信ファイルID
      uploadId || '',       // [9] アップロードID
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
}

// SHEET_RECEIVED: [6]=fileId, [8]=status(col9), [9]=ocrTime(col10), [12]=noteText(col13)
function updateReceivedFileStatus_(fileId, status) {
  var ss    = SpreadsheetApp.openById(getConfig_().sheetId);
  var sheet = ss.getSheetByName(SHEET_RECEIVED);
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][6] === fileId) {
      sheet.getRange(i + 1, 9).setValue(status);
      return;
    }
  }
}

// OCR完了時に status・OCR実行日時・備考テキストをシートスキャン1回でまとめて更新
function finalizeReceivedRow_(fileId, status, noteText) {
  var ss    = SpreadsheetApp.openById(getConfig_().sheetId);
  var sheet = ss.getSheetByName(SHEET_RECEIVED);
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][6] === fileId) {
      var row = i + 1;
      sheet.getRange(row, 9).setValue(status);         // [8] ステータス
      sheet.getRange(row, 10).setValue(new Date());    // [9] OCR実行日時
      if (noteText) sheet.getRange(row, 13).setValue(noteText); // [12] 備考テキスト
      return;
    }
  }
}
