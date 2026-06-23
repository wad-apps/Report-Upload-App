// adminSaveCorrection: 個数・距離の修正値決定ロジックをテスト
// Node.js で実行: node tests/saveCorrection.test.js
const assert = require('assert');
const { resolveCorrectedValues } = require('./saveCorrection.js');

let passed = 0, failed = 0;
function check(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '\n    got:     ', JSON.stringify(actual), '\n    expected:', JSON.stringify(expected)); failed++; }
}

console.log('--- resolveCorrectedValues ---');

// ケース1: 修正値が OCR と同じ → 修正フラグなし（空文字で保存しない）
check(
  resolveCorrectedValues({ fixedKosu: 5, fixedDistance: 120 }, { ocrKosu: 5, ocrDistance: 120 }),
  { newFixedKosu: '', newFixedDistance: '' },
  'OCRと同値 → 修正値を空（フラグなし）'
);

// ケース2: 修正値が OCR と異なる → 修正値を保存
check(
  resolveCorrectedValues({ fixedKosu: 3, fixedDistance: 90 }, { ocrKosu: 5, ocrDistance: 120 }),
  { newFixedKosu: 3, newFixedDistance: 90 },
  '異なる修正値 → そのまま保存'
);

// ケース3: 修正値が undefined/null（送られてこない）→ 変更なし扱い
check(
  resolveCorrectedValues({ fixedKosu: undefined, fixedDistance: undefined }, { ocrKosu: 5, ocrDistance: 120 }),
  { newFixedKosu: '', newFixedDistance: '' },
  '修正値未送信 → 空（変更なし）'
);

// ケース4: 距離だけ修正
check(
  resolveCorrectedValues({ fixedKosu: 5, fixedDistance: 90 }, { ocrKosu: 5, ocrDistance: 120 }),
  { newFixedKosu: '', newFixedDistance: 90 },
  '距離だけ修正 → 個数は空、距離は保存'
);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
