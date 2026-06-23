// フロントエンド側の純粋計算関数テスト
// Node.js で実行: node tests/frontendCalc.test.js
const assert = require('assert');
const { getOcrRowClass, calcSummaryStats, buildCorrectionPayload } = require('./frontendCalc.js');

let passed = 0, failed = 0;
function checkEq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '\n    got:     ', JSON.stringify(actual), '\n    expected:', JSON.stringify(expected)); failed++; }
}
function checkNum(actual, expected, label) {
  if (actual === expected) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '| got', actual, 'expected', expected); failed++; }
}

// --- getOcrRowClass ---
console.log('--- getOcrRowClass ---');
checkEq(getOcrRowClass(120), 'over-km-row', '120km → over-km-row');
checkEq(getOcrRowClass(100), '',            '100km → クラスなし（閾値ちょうど）');
checkEq(getOcrRowClass(90),  '',            '90km  → クラスなし');
checkEq(getOcrRowClass(0),   '',            '0km   → クラスなし');

// --- calcSummaryStats ---
// days: [{ start, distance, kosu }] (start が空なら非稼働)
console.log('--- calcSummaryStats ---');
var days = [
  { start: '08:00', distance: 120, kosu: 5 },
  { start: '09:00', distance:  90, kosu: 3 },
  { start: '',      distance:   0, kosu: 0 },  // 非稼働
  { start: '08:30', distance: 250, kosu: 8 },
];
var stats = calcSummaryStats(days);
checkNum(stats.workingDays,  3,   '稼働日数 = 3');
checkNum(stats.totalKosu,   16,   '個数合計 = 16 (5+3+8)');
checkNum(stats.totalDistance, 460, '走行距離合計 = 460 (120+90+250)');
checkNum(stats.totalOverKm,  170, '超過km合計 = 170 (20+0+150)');

// --- buildCorrectionPayload ---
// input_rows: [{ day, fixedStart, fixedEnd, fixedKosu, fixedDistance }]
console.log('--- buildCorrectionPayload ---');
var rows = [
  { day: 1, fixedStart: '08:00', fixedEnd: '17:00', fixedKosu: 3, fixedDistance: 90 },
  { day: 2, fixedStart: '',      fixedEnd: '',       fixedKosu: 0, fixedDistance: 0  },
];
var payload = buildCorrectionPayload(rows);
checkEq(payload[0], { day: 1, fixedStart: '08:00', fixedEnd: '17:00', fixedKosu: 3, fixedDistance: 90 }, '1日目: 全フィールド含む');
checkEq(payload[1], { day: 2, fixedStart: '',      fixedEnd: '',       fixedKosu: 0, fixedDistance: 0  }, '2日目: 空値もそのまま含む');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
