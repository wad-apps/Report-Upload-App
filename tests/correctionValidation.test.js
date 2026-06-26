// 修正保存バリデーション: 時刻フォーマット・負数チェックのテスト
// Node.js で実行: node tests/correctionValidation.test.js
const { isValidFixedTime, validateCorrections } = require('./correctionValidation.js');

let passed = 0, failed = 0;
function check(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '\n    got:     ', JSON.stringify(actual), '\n    expected:', JSON.stringify(expected)); failed++; }
}

console.log('--- isValidFixedTime ---');
check(isValidFixedTime(''),      true,  '空文字 → OK（稼働なし）');
check(isValidFixedTime(null),    true,  'null → OK');
check(isValidFixedTime('08:30'), true,  '08:30 → OK');
check(isValidFixedTime('23:59'), true,  '23:59 → OK');
check(isValidFixedTime('00:00'), true,  '00:00 → OK');
check(isValidFixedTime('9:30'),  true,  '9:30 → OK（1桁時刻）');
check(isValidFixedTime('0:00'),  true,  '0:00 → OK');
check(isValidFixedTime('abc'),   false, 'abc → NG');
check(isValidFixedTime('25:00'), false, '25:00 → NG（時刻範囲外）');
check(isValidFixedTime('12:60'), false, '12:60 → NG（分範囲外）');
check(isValidFixedTime('24:00'), false, '24:00 → NG');
check(isValidFixedTime('8'),     false, '8 → NG（コロンなし）');
check(isValidFixedTime('8:0'),   false, '8:0 → NG（分が1桁）');
check(isValidFixedTime('12:30:00'), false, '12:30:00 → NG（秒付き）');

console.log('\n--- validateCorrections ---');
check(
  validateCorrections([{ fixedStart: '08:00', fixedEnd: '17:00', fixedKosu: 5, fixedDistance: 80 }]),
  { ok: true },
  '正常ケース'
);
check(
  validateCorrections([{ fixedStart: 'abc',   fixedEnd: '17:00', fixedKosu: 5, fixedDistance: 80 }]),
  { ok: false, reason: 'invalid_time' },
  '開始時刻が不正文字列'
);
check(
  validateCorrections([{ fixedStart: '08:00', fixedEnd: '99:00', fixedKosu: 5, fixedDistance: 80 }]),
  { ok: false, reason: 'invalid_time' },
  '終了時刻が範囲外'
);
check(
  validateCorrections([{ fixedStart: '08:00', fixedEnd: '17:00', fixedKosu: -1, fixedDistance: 80 }]),
  { ok: false, reason: 'invalid_value' },
  'fixedKosu が負数'
);
check(
  validateCorrections([{ fixedStart: '08:00', fixedEnd: '17:00', fixedKosu: 5, fixedDistance: -50 }]),
  { ok: false, reason: 'invalid_value' },
  'fixedDistance が負数'
);
check(
  validateCorrections([{ fixedStart: '', fixedEnd: '', fixedKosu: 0, fixedDistance: 0 }]),
  { ok: true },
  '稼働なし（空・ゼロ）→ OK'
);
check(
  validateCorrections([{ fixedStart: '08:00', fixedEnd: '17:00', fixedKosu: null, fixedDistance: undefined }]),
  { ok: true },
  'kosu/distance が null/undefined → OK'
);
check(
  validateCorrections([
    { fixedStart: '08:00', fixedEnd: '17:00', fixedKosu: 3, fixedDistance: 50 },
    { fixedStart: '09:00', fixedEnd: '18:00', fixedKosu: -2, fixedDistance: 60 },
  ]),
  { ok: false, reason: 'invalid_value' },
  '2件目で負数NG'
);
check(
  validateCorrections([]),
  { ok: true },
  '空配列 → OK'
);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
