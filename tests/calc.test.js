// 超過km計算・月次集計の純粋関数テスト
// Node.js で実行: node tests/calc.test.js
const assert = require('assert');
const { calcDailyOverKm, calcMonthlyStats } = require('./calc.js');

let passed = 0, failed = 0;
function check(actual, expected, label) {
  if (actual === expected) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '| got', actual, 'expected', expected); failed++; }
}

// --- calcDailyOverKm ---
console.log('--- calcDailyOverKm ---');
check(calcDailyOverKm(120),  20,  '120km → 超過20km');
check(calcDailyOverKm(90),    0,  '90km  → 超過なし');
check(calcDailyOverKm(100),   0,  '100km → 閾値ちょうど、超過なし');
check(calcDailyOverKm(250), 150,  '250km → 超過150km');
check(calcDailyOverKm(0),     0,  '0km   → 超過なし');

// --- calcMonthlyStats (受け入れ基準 6-5 の検証値) ---
// distances = [120, 90, 100, 250] → overKm = [20, 0, 0, 150] → totalOverKm = 170
console.log('--- calcMonthlyStats ---');
var ocrRows = [
  // [fixedDistance, ocrDistance, fixedKosu, ocrKosu]
  [null, 120, null, 5],
  [null,  90, null, 3],
  [90,   100, 2,    4],  // fixedDistance=90 優先
  [null, 250, null, 8],
];
var stats = calcMonthlyStats(ocrRows);
check(stats.totalOverKm,   170, '超過km合計 = 170 (20+0+0+150)');
check(stats.totalDistance, 550, '走行距離合計 = 550 (120+90+90+250) ※row3はfixedDistance=90優先');
check(stats.totalKosu,      18, '個数合計 = 18 (5+3+2+8) ※row3はfixedKosu=2優先');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
