// OcrService.gs の parseValidationResult_ テスト
// Node.js で実行: node tests/reportValidation.test.js
const { parseValidationResult } = require('./reportValidation.js');

let passed = 0, failed = 0;
function checkEq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '\n    got:     ', JSON.stringify(actual), '\n    expected:', JSON.stringify(expected)); failed++; }
}

console.log('--- parseValidationResult ---');

// 正常: 月報OK・判読OK
checkEq(
  parseValidationResult('{"isReport":true,"canRead":true,"reason":null}'),
  { isReport: true, canRead: true, reason: null },
  '正常 → isReport:true, canRead:true, reason:null'
);

// 月報ではない
checkEq(
  parseValidationResult('{"isReport":false,"canRead":true,"reason":"レシートです"}'),
  { isReport: false, canRead: true, reason: 'レシートです' },
  '月報でない → isReport:false, reason付き'
);

// 判読不可
checkEq(
  parseValidationResult('{"isReport":true,"canRead":false,"reason":"暗すぎて読めません"}'),
  { isReport: true, canRead: false, reason: '暗すぎて読めません' },
  '判読不可 → canRead:false, reason付き'
);

// 両方NG
checkEq(
  parseValidationResult('{"isReport":false,"canRead":false,"reason":"白紙です"}'),
  { isReport: false, canRead: false, reason: '白紙です' },
  '両方NG → isReport:false, canRead:false'
);

// テキストにJSONが埋め込まれている
checkEq(
  parseValidationResult('以下のJSONを返します:\n{"isReport":true,"canRead":true,"reason":null}\n以上。'),
  { isReport: true, canRead: true, reason: null },
  'JSON埋め込みテキスト → パース成功'
);

// JSONなし → フォールバック（警告しない方向で安全側）
checkEq(
  parseValidationResult('判定できませんでした'),
  { isReport: true, canRead: true, reason: null },
  'JSONなし → フォールバック ok:true'
);

// 不正JSON → フォールバック
checkEq(
  parseValidationResult('{invalid json}'),
  { isReport: true, canRead: true, reason: null },
  '不正JSON → フォールバック ok:true'
);

// reason が空文字 → null に正規化
checkEq(
  parseValidationResult('{"isReport":true,"canRead":true,"reason":""}'),
  { isReport: true, canRead: true, reason: null },
  'reason が空文字 → null に正規化'
);

// isReport/canRead フィールドが欠損 → trueにフォールバック
checkEq(
  parseValidationResult('{}'),
  { isReport: true, canRead: true, reason: null },
  'フィールド欠損 → すべて安全側フォールバック'
);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
