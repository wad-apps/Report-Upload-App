// writeOcrResults_ の行変換ロジックテスト
// Node.js で実行: node tests/ocrRow.test.js
const { buildOcrRow } = require('./ocrRow.js');

let passed = 0, failed = 0;
function checkEq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '\n    got:     ', JSON.stringify(actual), '\n    expected:', JSON.stringify(expected)); failed++; }
}
function checkVal(actual, expected, label) {
  if (actual === expected) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '| got', JSON.stringify(actual), 'expected', JSON.stringify(expected)); failed++; }
}

// 固定引数（テスト用ダミー）
var CTX = { uid: 'U001', name: '田中', site: '埼玉', yearMonth: '2026-04', fileId: 'F1', uploadId: 'AA' };

console.log('--- 通常稼働日（kosu・distance あり） ---');
var row = buildOcrRow({ day: 5, start: '07:46', end: '17:50', kosu: 101, distance: 125 }, CTX);
checkVal(row.length, 17,      '列数 = 17');
checkVal(row[4],  5,          '[4] day = 5');
checkVal(row[5],  '07:46',   '[5] start');
checkVal(row[6],  '17:50',   '[6] end');
checkVal(row[7],  true,       '[7] hasStartTime = true');
checkVal(row[8],  '未確認',   '[8] status');
checkVal(row[13], 101,        '[13] kosu = 101');
checkVal(row[14], 125,        '[14] distance = 125');
checkVal(row[15], '',         '[15] 修正後個数 = 空');
checkVal(row[16], '',         '[16] 修正後走行距離 = 空');

console.log('--- kosu/distance が null → 空文字 ---');
var rowNull = buildOcrRow({ day: 23, start: null, end: null, kosu: null, distance: null }, CTX);
checkVal(rowNull[13], '', '[13] kosu null → ""');
checkVal(rowNull[14], '', '[14] distance null → ""');
checkVal(rowNull[7],  false, '[7] hasStartTime = false（稼働なし）');

console.log('--- kosu/distance が undefined → 空文字（フィールド欠損時） ---');
var rowUndef = buildOcrRow({ day: 24, start: null, end: null }, CTX);
checkVal(rowUndef[13], '', '[13] kosu undefined → ""');
checkVal(rowUndef[14], '', '[14] distance undefined → ""');

console.log('--- kosu/distance が 0 → 0（空文字に変換しない） ---');
var rowZero = buildOcrRow({ day: 10, start: '08:00', end: '17:00', kosu: 0, distance: 0 }, CTX);
checkVal(rowZero[13], 0, '[13] kosu=0 → 0');
checkVal(rowZero[14], 0, '[14] distance=0 → 0');

console.log('--- 3桁距離（桁落ちしないこと） ---');
var rowBig = buildOcrRow({ day: 20, start: '08:00', end: '17:00', kosu: 112, distance: 145 }, CTX);
checkVal(rowBig[14], 145, '[14] distance=145 → 145（3桁維持）');

console.log('--- 設計書5-2: day5のダミー期待値 ---');
var day5 = buildOcrRow({ day: 5, start: '07:46', end: '17:50', kosu: 101, distance: 125 }, CTX);
checkVal(day5[4],  5,      'day=5');
checkVal(day5[5],  '07:46', 'start=07:46');
checkVal(day5[6],  '17:50', 'end=17:50');
checkVal(day5[13], 101,     'kosu=101');
checkVal(day5[14], 125,     'distance=125');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
