// Schema test: Setup.gs に新列が定義されているか
// Node.js で実行: node tests/schema.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const setupGs = fs.readFileSync(path.join(__dirname, '../Setup.gs'), 'utf-8');

const NEW_OCR_COLS = ['個数', '走行距離(km)', '修正後個数', '修正後走行距離'];
const NEW_MONTHLY_COLS = ['個数合計', '走行距離合計(km)', '超過km合計'];

let passed = 0, failed = 0;
function check(condition, label) {
  if (condition) { console.log('  PASS:', label); passed++; }
  else           { console.error('  FAIL:', label); failed++; }
}

console.log('--- SHEET_OCR 新列 ---');
NEW_OCR_COLS.forEach(function(col) {
  check(setupGs.includes("'" + col + "'"), 'SHEET_OCR contains ' + col);
});

console.log('--- SHEET_MONTHLY 新列 ---');
NEW_MONTHLY_COLS.forEach(function(col) {
  check(setupGs.includes("'" + col + "'"), 'SHEET_MONTHLY contains ' + col);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
