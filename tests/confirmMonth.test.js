// handleAdminConfirmMonth_ の集計ロジックテスト
// Node.js で実行: node tests/confirmMonth.test.js
const assert = require('assert');
const { calcMonthlyTotals } = require('./confirmMonth.js');

let passed = 0, failed = 0;
function checkNum(actual, expected, label) {
  if (actual === expected) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '| got', actual, 'expected', expected); failed++; }
}

// 受け入れ基準 6-5: distances = [120, 90, 100, 250] → overKm = [20, 0, 0, 150] → total = 170
console.log('--- 受け入れ基準 6-5 ---');
var ocrRows = [
  // [fixedDistance, ocrDistance, fixedKosu, ocrKosu, hasWorkingDay]
  [null, 120, null, 5, true],
  [null,  90, null, 3, true],
  [null, 100, null, 4, true],
  [null, 250, null, 8, true],
];
var totals = calcMonthlyTotals(ocrRows);
checkNum(totals.totalOverKm,   170, '超過km合計 = 170');
checkNum(totals.totalDistance, 560, '走行距離合計 = 560 (120+90+100+250)');
checkNum(totals.totalKosu,      20, '個数合計 = 20 (5+3+4+8)');

console.log('--- fixedDistance 優先 ---');
var ocrRowsWithFix = [
  [90,  120, 3, 5, true],   // fixedDistance=90, fixedKosu=3
  [null, 90, null, 3, true],
];
var totals2 = calcMonthlyTotals(ocrRowsWithFix);
checkNum(totals2.totalDistance, 180, '走行距離合計 = 180 (90+90)');
checkNum(totals2.totalKosu,       6, '個数合計 = 6 (3+3)');
checkNum(totals2.totalOverKm,     0, '超過km合計 = 0');

console.log('--- 稼働なし日は除外（走行距離0） ---');
var ocrRowsWithNonWorking = [
  [null, 250, null, 8, true],
  [null,   0, null, 0, false],  // 稼働なし → 距離0のまま計算
];
var totals3 = calcMonthlyTotals(ocrRowsWithNonWorking);
checkNum(totals3.totalOverKm, 150, '超過km合計 = 150（稼働なし日は0km）');

console.log('--- fixedDistance=0 / fixedKosu=0 は有効な修正値 ---');
var rowsZeroFix = [
  [0, 150, 0, 8, true],   // 0km修正・0件修正 → 0 を採用（150や8へフォールバックしない）
  [null, 50, null, 2, true],
];
var totals4 = calcMonthlyTotals(rowsZeroFix);
checkNum(totals4.totalDistance,  50, 'fixedDistance=0 は 0km 採用');
checkNum(totals4.totalKosu,       2, 'fixedKosu=0 は 0 採用');
checkNum(totals4.totalOverKm,     0, '0+50=50km → 超過なし');

console.log('--- 境界値: 全日 100km ちょうど ---');
var rowsAtThreshold = [
  [null, 100, null, 1, true],
  [null, 100, null, 1, true],
  [null, 100, null, 1, true],
];
var totals5 = calcMonthlyTotals(rowsAtThreshold);
checkNum(totals5.totalOverKm, 0, '全日 100km ちょうど → 超過km合計 = 0');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
