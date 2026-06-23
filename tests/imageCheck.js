// 画像品質チェックの純粋計算関数（Node.js テスト用）
// app.js の checkImageQuality_ で使う同ロジックを保つ。

// pixelData: RGBA バイト列 (Uint8Array/Uint8ClampedArray)
// 戻り値: 0-255 の平均輝度
function calcAverageBrightness(pixelData) {
  var total = 0;
  var count = 0;
  for (var i = 0; i < pixelData.length; i += 4) {
    total += (pixelData[i] + pixelData[i + 1] + pixelData[i + 2]) / 3;
    count++;
  }
  return count > 0 ? Math.round(total / count) : 0;
}

// ラプラシアンカーネル [0,1,0,1,-4,1,0,1,0] で各ピクセルの二次微分を計算し、分散を返す
// 分散が大きい → エッジが多い（鮮明）、0 に近い → ぼけている
function calcLaplacianVariance(pixelData, width, height) {
  if (width < 3 || height < 3) return 0;
  var values = [];
  for (var y = 1; y < height - 1; y++) {
    for (var x = 1; x < width - 1; x++) {
      var gray = function(px, py) {
        var idx = (py * width + px) * 4;
        return (pixelData[idx] + pixelData[idx + 1] + pixelData[idx + 2]) / 3;
      };
      var lap = -4 * gray(x, y)
        + gray(x - 1, y) + gray(x + 1, y)
        + gray(x, y - 1) + gray(x, y + 1);
      values.push(lap);
    }
  }
  if (!values.length) return 0;
  var mean = values.reduce(function(s, v) { return s + v; }, 0) / values.length;
  var variance = values.reduce(function(s, v) { return s + (v - mean) * (v - mean); }, 0) / values.length;
  return Math.round(variance);
}

// width/height: 画像サイズ、brightness: 平均輝度、blurVariance: ラプラシアン分散
// cfg: { minLongEdge, brightnessMin, brightnessMax, blurVarMin }
// 戻り値: { ok:true } または { ok:false, reason, message }
function classifyQuality(width, height, brightness, blurVariance, cfg) {
  var longEdge = Math.max(width, height);
  if (longEdge < cfg.minLongEdge) {
    return { ok: false, reason: 'resolution', message: '画像が小さすぎます。もう一度撮影してください' };
  }
  if (brightness < cfg.brightnessMin) {
    return { ok: false, reason: 'dark', message: '暗すぎます。明るい場所で撮り直してください' };
  }
  if (brightness > cfg.brightnessMax) {
    return { ok: false, reason: 'bright', message: '白飛びしています。明るさを調整して撮り直してください' };
  }
  if (blurVariance < cfg.blurVarMin) {
    return { ok: false, reason: 'blur', message: 'ピントが合っていません。撮り直してください' };
  }
  return { ok: true };
}

module.exports = { calcAverageBrightness: calcAverageBrightness, calcLaplacianVariance: calcLaplacianVariance, classifyQuality: classifyQuality };
