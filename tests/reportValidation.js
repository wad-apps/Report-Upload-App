// OcrService.gs の parseValidationResult_ に対応する純粋関数（Node.js テスト用）

// text: Claude API レスポンステキスト
// 戻り値: { isReport: bool, canRead: bool, reason: string|null }
// 失敗時は { isReport: true, canRead: true, reason: null } にフォールバック（過剰ブロック防止）
function parseValidationResult(text) {
  var match = text.match(/\{[\s\S]*?\}/);
  if (!match) return { isReport: true, canRead: true, reason: null };
  try {
    var parsed = JSON.parse(match[0]);
    return {
      isReport: parsed.isReport !== false,
      canRead:  parsed.canRead  !== false,
      reason:   parsed.reason   || null,
    };
  } catch (e) {
    return { isReport: true, canRead: true, reason: null };
  }
}

module.exports = { parseValidationResult: parseValidationResult };
