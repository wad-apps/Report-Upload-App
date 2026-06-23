// adminGetOcrDetail レスポンス形状テスト
// GAS の Spreadsheet 依存部はモックで置き換え、純粋な変換ロジックを検証する
// Node.js で実行: node tests/ocrDetail.test.js
const assert = require('assert');
const { buildDayEntry } = require('./ocrDetail.js');

let passed = 0, failed = 0;
function check(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '\n    got:     ', JSON.stringify(actual), '\n    expected:', JSON.stringify(expected)); failed++; }
}
function checkNum(actual, expected, label) {
  if (actual === expected) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '| got', actual, 'expected', expected); failed++; }
}

// SHEET_OCR 行の模擬 (columns 0-16)
// [0]uid [1]name [2]site [3]ym [4]day [5]start [6]end [7]isWorking [8]status
// [9]fixedStart [10]fixedEnd [11]fileId [12]uploadId [13]kosu [14]distance [15]fixedKosu [16]fixedDistance

console.log('--- buildDayEntry: 修正値あり ---');
var rowWithFix = [
  'uid1','田中','A現場','2026-06',15,'08:00','17:00',true,'修正済み',
  '09:00','18:00','fid','uid123',5,120,3,90
];
var entry = buildDayEntry(rowWithFix);
checkNum(entry.kosu,      3,  'fixedKosu=3 が採用される');
checkNum(entry.distance,  90, 'fixedDistance=90 が採用される');
checkNum(entry.overKm,    0,  '90km → overKm=0');

console.log('--- buildDayEntry: 修正値なし ---');
var rowNoFix = [
  'uid1','田中','A現場','2026-06',20,'08:00','17:00',true,'確認待ち',
  '','','fid','uid456','',250,'',''
];
entry = buildDayEntry(rowNoFix);
checkNum(entry.kosu,      0,   'fixedKosu空 → ocrKosu空 → 0');
checkNum(entry.distance,  250, 'fixedDistance空 → ocrDistance=250 が採用される');
checkNum(entry.overKm,    150, '250km → overKm=150');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
