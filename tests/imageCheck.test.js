// 画像品質チェックの純粋計算関数テスト
// Node.js で実行: node tests/imageCheck.test.js
const { calcAverageBrightness, calcLaplacianVariance, classifyQuality } = require('./imageCheck.js');

let passed = 0, failed = 0;
function checkNum(actual, expected, label) {
  if (actual === expected) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '| got', actual, 'expected', expected); failed++; }
}
function checkBool(actual, expected, label) {
  if (actual === expected) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '| got', actual, 'expected', expected); failed++; }
}
function checkEq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log('  PASS:', label); passed++; }
  else { console.error('  FAIL:', label, '\n    got:     ', JSON.stringify(actual), '\n    expected:', JSON.stringify(expected)); failed++; }
}

// --- calcAverageBrightness ---
// pixelData: Uint8ClampedArray の RGBA データ
// 輝度 = (R + G + B) / 3 の平均
console.log('--- calcAverageBrightness ---');
// 全白 (255,255,255,255) x 4px
var white4 = new Uint8Array([255,255,255,255, 255,255,255,255, 255,255,255,255, 255,255,255,255]);
checkNum(calcAverageBrightness(white4), 255, '全白 → 輝度 255');

// 全黒 (0,0,0,255) x 4px
var black4 = new Uint8Array([0,0,0,255, 0,0,0,255, 0,0,0,255, 0,0,0,255]);
checkNum(calcAverageBrightness(black4), 0, '全黒 → 輝度 0');

// 中間グレー (128,128,128,255) x 4px
var gray4 = new Uint8Array([128,128,128,255, 128,128,128,255, 128,128,128,255, 128,128,128,255]);
checkNum(calcAverageBrightness(gray4), 128, '中間グレー → 輝度 128');

// --- calcLaplacianVariance ---
// 均一な画像（全同値）はラプラシアン分散 = 0（完全にぼけている）
console.log('--- calcLaplacianVariance ---');
// 4x4 の均一グレー画像
var uniform16 = new Uint8Array(4 * 4 * 4); // 全0
for (var i = 0; i < uniform16.length; i += 4) {
  uniform16[i] = 128; uniform16[i+1] = 128; uniform16[i+2] = 128; uniform16[i+3] = 255;
}
checkNum(calcLaplacianVariance(uniform16, 4, 4), 0, '均一画像 → 分散 0（完全ぼけ）');

// エッジがある画像: 左半分 0、右半分 255 の 4x4 グレー画像
var edged16 = new Uint8Array(4 * 4 * 4);
for (var r = 0; r < 4; r++) {
  for (var c = 0; c < 4; c++) {
    var idx = (r * 4 + c) * 4;
    var v = c < 2 ? 0 : 255;
    edged16[idx] = v; edged16[idx+1] = v; edged16[idx+2] = v; edged16[idx+3] = 255;
  }
}
var edgeVar = calcLaplacianVariance(edged16, 4, 4);
checkBool(edgeVar > 0, true, 'エッジあり画像 → 分散 > 0（ぼけていない）');

// --- classifyQuality ---
// 閾値定数: MIN_LONG_EDGE=800, BRIGHTNESS_MIN=30, BRIGHTNESS_MAX=240, BLUR_VAR_MIN=50
console.log('--- classifyQuality ---');
var cfg = { minLongEdge: 800, brightnessMin: 30, brightnessMax: 240, blurVarMin: 50 };

checkEq(classifyQuality(1200, 900, 128, 200, cfg),  { ok: true },                       '正常画像 → ok:true');
checkEq(classifyQuality(600,  400, 128, 200, cfg),  { ok: false, reason: 'resolution', message: '画像が小さすぎます。もう一度撮影してください' }, '低解像度 → resolution NG');
checkEq(classifyQuality(1200, 900, 10,  200, cfg),  { ok: false, reason: 'dark',       message: '暗すぎます。明るい場所で撮り直してください' },      '暗すぎ → dark NG');
checkEq(classifyQuality(1200, 900, 250, 200, cfg),  { ok: false, reason: 'bright',     message: '白飛びしています。明るさを調整して撮り直してください' }, '白飛び → bright NG');
checkEq(classifyQuality(1200, 900, 128,  10, cfg),  { ok: false, reason: 'blur',       message: 'ピントが合っていません。撮り直してください' },           'ピンぼけ → blur NG');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
