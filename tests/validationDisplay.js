// app.js の buildValidationToast に対応する純粋関数（Node.js テスト用）

// uploadReport レスポンスから表示すべきトーストメッセージを返す。
// 警告不要なら null を返す。
function buildValidationToast(res) {
  if (!res || !res.validationWarning) return null;
  var base = '月報として認識できなかった可能性があります。問題がなければそのままお待ちください。';
  if (res.validationReason) return base + '\n（' + res.validationReason + '）';
  return base;
}

module.exports = { buildValidationToast: buildValidationToast };
