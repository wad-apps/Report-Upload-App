// 数式インジェクション防止サニタイズのテスト
// Node.js で実行: node tests/sanitize.test.js
const { sanitizeSheetValue, csvSafe, isValidUploadId } = require('./sanitize.js');

let passed = 0, failed = 0;
function check(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '\n    got:     ', JSON.stringify(actual), '\n    expected:', JSON.stringify(expected)); failed++; }
}

console.log('--- sanitizeSheetValue（Sheets 数式インジェクション防止）---');
check(sanitizeSheetValue('山田太郎'),             '山田太郎',              '通常名前 → そのまま');
check(sanitizeSheetValue(''),                     '',                      '空文字 → そのまま');
check(sanitizeSheetValue(null),                   null,                    'null → null');
check(sanitizeSheetValue('=IMPORTRANGE("url")'),  "'=IMPORTRANGE(\"url\")", '= 始まり → 先頭に \'');
check(sanitizeSheetValue('+1234567890'),           "'+1234567890",          '+ 始まり → 先頭に \'');
check(sanitizeSheetValue('-SUM(A1:A10)'),          "'-SUM(A1:A10)",         '- 始まり → 先頭に \'');
check(sanitizeSheetValue('@SUM'),                 "'@SUM",                 '@ 始まり → 先頭に \'');
check(sanitizeSheetValue('|pipeline'),            "'|pipeline",            '| 始まり → 先頭に \'');
check(sanitizeSheetValue('%rate'),                "'%rate",                '% 始まり → 先頭に \'');
check(sanitizeSheetValue('A=B'),                  'A=B',                   '中間の = → そのまま');
check(sanitizeSheetValue('ABC123'),               'ABC123',                '英数字 → そのまま');

console.log('\n--- csvSafe（CSV インジェクション防止）---');
check(csvSafe('山田太郎'),                  '山田太郎',           '通常名前 → そのまま');
check(csvSafe(''),                          '',                   '空文字 → そのまま');
check(csvSafe(null),                        '',                   'null → 空文字');
check(csvSafe('=HYPERLINK("url","x")'),     "'=HYPERLINK(\"\"url\"\",\"\"x\"\")", '= 始まり + 内部 " → 両方サニタイズ');
check(csvSafe('田中"テスト"'),              '田中""テスト""',     '内部の " → "" にエスケープ');
check(csvSafe('+81-90-1234'),               "'+81-90-1234",       '+ 始まり → 先頭に \'');
check(csvSafe('-SUM(A1)'),                  "'-SUM(A1)",          '- 始まり → 先頭に \'');
check(csvSafe('@user'),                     "'@user",             '@ 始まり → 先頭に \'');
check(csvSafe('東京営業所'),                '東京営業所',         '日本語 → そのまま');

console.log('\n--- isValidUploadId（uploadId フォーマット検証）---');
check(isValidUploadId(''),            true,  '空文字 → OK（省略可）');
check(isValidUploadId(null),          true,  'null → OK');
check(isValidUploadId('AB3XZ9'),      true,  '6文字英数大文字 → OK（通常生成パターン）');
check(isValidUploadId('abc123'),      true,  '小文字英数 → OK');
check(isValidUploadId('a-b_c'),       true,  'ハイフン・アンダースコア → OK');
check(isValidUploadId('A'.repeat(32)), true,  '32文字 → OK（上限）');
check(isValidUploadId('A'.repeat(33)), false, '33文字 → NG（上限超過）');
check(isValidUploadId('=FORMULA'),    false, '= 始まり → NG');
check(isValidUploadId('abc def'),     false, 'スペース → NG');
check(isValidUploadId('../etc/passwd'), false, 'パス操作文字 → NG');
check(isValidUploadId('<script>'),    false, 'HTML タグ → NG');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
