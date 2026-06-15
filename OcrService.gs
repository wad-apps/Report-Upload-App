// Claude API を使った月報OCRサービス
// Script Properties に CLAUDE_API_KEY を設定しておくこと

var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
var CLAUDE_MODEL   = 'claude-sonnet-4-6';

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

// ===== メイン関数 =====

// Code.gsのhandleUploadReportから呼ばれる
function runOcr(fileId, yearMonth, lineUserId, firstBase64, secondBase64, pdfBase64) {
  var driver = getDriverByUserId(lineUserId);
  if (!driver) throw new Error('Driver not found: ' + lineUserId);

  updateReceivedFileStatus_(fileId, 'OCR中');

  try {
    var days;
    var hasNote  = false;
    var expenses = [];
    var noteText = '';

    if (pdfBase64) {
      // PDF: DAYS と META を同一PDFに対し2パスで読む
      var daysRaw  = callClaudeApi_(pdfBase64, 'application/pdf', OCR_PROMPT_DAYS);
      var metaRaw  = callClaudeApi_(pdfBase64, 'application/pdf', OCR_PROMPT_META);
      var daysResult = parseDaysResult_(daysRaw);
      var metaResult = parseMetaResult_(metaRaw);
      days     = daysResult.days;
      hasNote  = metaResult.hasNote;
      expenses = metaResult.expenses;
      noteText = metaResult.noteText;
    } else {
      // 画像: 前半・後半で DAYS プロンプト（2回）、後半のみで META プロンプト（1回）
      var promptFirst  = OCR_PROMPT_DAYS + '\n\n【補足】これは月報の前半部分の画像です。';
      var promptSecond = OCR_PROMPT_DAYS + '\n\n【補足】これは月報の後半部分の画像です。';
      var firstRaw  = callClaudeApi_(firstBase64,  'image/jpeg', promptFirst);
      var secondRaw = callClaudeApi_(secondBase64, 'image/jpeg', promptSecond);
      var firstResult  = parseDaysResult_(firstRaw);
      var secondResult = parseDaysResult_(secondRaw);
      days = mergeHalves_(firstResult.days, secondResult.days);

      // 立替・備考は後半画像に丸ごと収まるため後半からのみ読む
      var metaRaw    = callClaudeApi_(secondBase64, 'image/jpeg', OCR_PROMPT_META);
      var metaResult = parseMetaResult_(metaRaw);
      hasNote  = metaResult.hasNote;
      expenses = metaResult.expenses;
      noteText = metaResult.noteText;
    }

    writeOcrResults_(lineUserId, driver.name, yearMonth, fileId, days);
    if (expenses.length > 0) {
      saveExpenseRows_(lineUserId, driver.name, yearMonth, fileId, expenses);
    }
    if (noteText) {
      updateReceivedNoteText_(fileId, noteText);
    }
    updateReceivedFileStatus_(fileId, '確認待ち');
    updateReceivedOcrTime_(fileId);

    return { workingDays: countWorkingDays_(days), days: days };

  } catch (err) {
    updateReceivedFileStatus_(fileId, 'OCRエラー');
    throw err;
  }
}

// ===== Claude API呼び出し =====

function callClaudeApi_(base64, mimeType, prompt) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set in Script Properties');

  var contentItem = mimeType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image',    source: { type: 'base64', media_type: mimeType,           data: base64 } };

  var body = {
    model:      CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [contentItem, { type: 'text', text: prompt }]
    }]
  };

  var res = UrlFetchApp.fetch(CLAUDE_API_URL, {
    method:           'post',
    headers: {
      'x-api-key':          apiKey,
      'anthropic-version':  '2023-06-01',
      'content-type':       'application/json',
    },
    payload:          JSON.stringify(body),
    muteHttpExceptions: true,
  });

  var json = JSON.parse(res.getContentText());
  if (json.error) throw new Error('Claude API error: ' + json.error.message);

  return json.content[0].text;
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

function writeOcrResults_(lineUserId, driverName, yearMonth, fileId, days) {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_OCR);

  // 同じ lineUserId + yearMonth の既存行を削除
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === lineUserId && data[i][2] === yearMonth) {
      sheet.deleteRow(i + 1);
    }
  }

  if (days.length === 0) return;

  var rows = days.map(function(d) {
    var hasStartTime = d.start !== null && d.start !== undefined && d.start !== '';
    return [
      lineUserId,        // [0]  LINEユーザーID
      driverName,        // [1]  ドライバー名
      yearMonth,         // [2]  年月
      d.day,             // [3]  日
      d.start || '',     // [4]  開始時間
      d.end   || '',     // [5]  終了時間
      hasStartTime,      // [6]  稼働フラグ
      '未確認',           // [7]  確認ステータス
      '',                // [8]  修正後開始時間
      '',                // [9]  修正後終了時間
      fileId,            // [10] 受信ファイルID
    ];
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function saveExpenseRows_(lineUserId, driverName, yearMonth, fileId, expenses) {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_EXPENSE);
  if (!sheet) return;

  // 同じ lineUserId + yearMonth の既存立替行を削除
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === lineUserId && data[i][2] === yearMonth) {
      sheet.deleteRow(i + 1);
    }
  }

  var rows = expenses.map(function(exp, idx) {
    return [
      lineUserId,           // [0] LINEユーザーID
      driverName,           // [1] ドライバー名
      yearMonth,            // [2] 年月
      idx + 1,              // [3] 行番号
      exp.category || '',   // [4] 区分
      exp.amount   !== null && exp.amount !== undefined ? exp.amount : '', // [5] 金額
      exp.note     || '',   // [6] 内容
      '未確認',              // [7] 確認ステータス
      fileId,               // [8] 受信ファイルID
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function updateReceivedFileStatus_(fileId, status) {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_RECEIVED);
  var data  = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (data[i][5] === fileId) {
      sheet.getRange(i + 1, 8).setValue(status);
      return;
    }
  }
}

function updateReceivedNoteText_(fileId, noteText) {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_RECEIVED);
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][5] === fileId) {
      sheet.getRange(i + 1, 12).setValue(noteText); // 列[11] = 備考テキスト
      return;
    }
  }
}

function updateReceivedOcrTime_(fileId) {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_RECEIVED);
  var data  = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (data[i][5] === fileId) {
      sheet.getRange(i + 1, 9).setValue(new Date());
      return;
    }
  }
}
