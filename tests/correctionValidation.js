// 修正保存バリデーション（Node.js テスト用）
// GAS 側 handleAdminSaveCorrection_ のバリデーション部分と同ロジック

var TIME_RE = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;

function isValidFixedTime(val) {
  if (val === null || val === undefined || val === '') return true;
  return TIME_RE.test(String(val));
}

// corrections 配列を検証。問題あれば { ok: false, reason: '...' }、なければ { ok: true }
function validateCorrections(corrections) {
  for (var i = 0; i < corrections.length; i++) {
    var c = corrections[i];
    if (!isValidFixedTime(c.fixedStart)) return { ok: false, reason: 'invalid_time' };
    if (!isValidFixedTime(c.fixedEnd))   return { ok: false, reason: 'invalid_time' };
    var fk = (c.fixedKosu     !== undefined && c.fixedKosu     !== null) ? Number(c.fixedKosu)     : undefined;
    var fd = (c.fixedDistance !== undefined && c.fixedDistance !== null) ? Number(c.fixedDistance) : undefined;
    if (fk !== undefined && fk < 0) return { ok: false, reason: 'invalid_value' };
    if (fd !== undefined && fd < 0) return { ok: false, reason: 'invalid_value' };
  }
  return { ok: true };
}

module.exports = { isValidFixedTime: isValidFixedTime, validateCorrections: validateCorrections };
