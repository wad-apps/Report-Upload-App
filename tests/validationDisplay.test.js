// app.js の buildValidationToast テスト
// Node.js で実行: node tests/validationDisplay.test.js
const { buildValidationToast } = require('./validationDisplay.js');

let passed = 0, failed = 0;
function checkEq(actual, expected, label) {
  const ok = actual === expected;
  if (ok) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '\n    got:     ', JSON.stringify(actual), '\n    expected:', JSON.stringify(expected)); failed++; }
}
function checkNull(actual, label) {
  if (actual === null) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '| got', JSON.stringify(actual), 'expected null'); failed++; }
}
function checkIncludes(actual, substr, label) {
  if (actual && actual.includes(substr)) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '| got', JSON.stringify(actual), 'does not include', JSON.stringify(substr)); failed++; }
}

console.log('--- buildValidationToast ---');

// 警告なし → null（トーストを表示しない）
checkNull(buildValidationToast({ validationWarning: false }), 'warning=false → null');
checkNull(buildValidationToast({}),                           'no warning field → null');
checkNull(buildValidationToast(null),                         'null res → null');

// 警告あり・理由なし
var msg1 = buildValidationToast({ validationWarning: true, validationReason: null });
checkIncludes(msg1, '月報として認識できなかった', 'warning=true, reason=null → 基本メッセージ含む');

// 警告あり・理由あり
var msg2 = buildValidationToast({ validationWarning: true, validationReason: 'レシートの写真が含まれています' });
checkIncludes(msg2, '月報として認識できなかった', 'warning=true, reason付き → 基本メッセージ含む');
checkIncludes(msg2, 'レシートの写真が含まれています', 'warning=true, reason付き → reason含む');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
