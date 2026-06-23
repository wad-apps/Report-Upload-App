// 修正値の決定ロジック（Node.js テスト用）
// GAS 側 handleAdminSaveCorrection_ の個数・距離部分と同ロジック

// fixed: { fixedKosu, fixedDistance } (フロントから受け取った修正値、undefined 可)
// ocr:   { ocrKosu, ocrDistance }     (シートに保存されている OCR 値)
// 戻り値: { newFixedKosu, newFixedDistance }
//   - OCR と同値なら '' (差分なし = 修正値列を空にする)
//   - 異なる値なら修正値をそのまま返す
//   - undefined なら '' (未送信 = 変更なし)
function resolveCorrectedValues(fixed, ocr) {
  var fk = (fixed.fixedKosu     !== undefined && fixed.fixedKosu     !== null) ? fixed.fixedKosu     : undefined;
  var fd = (fixed.fixedDistance !== undefined && fixed.fixedDistance !== null) ? fixed.fixedDistance : undefined;

  var newFixedKosu     = (fk !== undefined && fk !== ocr.ocrKosu)     ? fk : '';
  var newFixedDistance = (fd !== undefined && fd !== ocr.ocrDistance)  ? fd : '';

  return { newFixedKosu: newFixedKosu, newFixedDistance: newFixedDistance };
}

module.exports = { resolveCorrectedValues: resolveCorrectedValues };
