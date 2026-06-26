// 数式インジェクション防止サニタイズ（Node.js テスト用）
// Code.gs の sanitizeSheetValue_ / dashboard.js の csvSafe_ と同ロジック

// Sheets 数式インジェクション防止
function sanitizeSheetValue(val) {
  if (val === null || val === undefined) return val;
  var str = String(val);
  return /^[=+\-@\t\r|%]/.test(str) ? "'" + str : str;
}

// CSV インジェクション防止
function csvSafe(val) {
  var str = (val === null || val === undefined) ? '' : String(val);
  str = str.replace(/"/g, '""');
  if (/^[=+\-@\t\r|%]/.test(str)) str = "'" + str;
  return str;
}

// uploadId フォーマット検証
function isValidUploadId(val) {
  if (!val) return true;  // 空は許可（省略可）
  return /^[A-Za-z0-9_\-]{1,32}$/.test(String(val));
}

module.exports = { sanitizeSheetValue: sanitizeSheetValue, csvSafe: csvSafe, isValidUploadId: isValidUploadId };
