// Script Properties から実行時に設定を取得（未設定は即エラー）。
// Script Properties に SHEET_ID・DRIVE_FOLDER_ID を設定しておくこと。

var _config = null;

function getConfig_() {
  if (_config) return _config;
  var props    = PropertiesService.getScriptProperties();
  var sheetId  = props.getProperty('SHEET_ID');
  var folderId = props.getProperty('DRIVE_FOLDER_ID');
  if (!sheetId)  throw new Error('Script Property SHEET_ID が未設定です');
  if (!folderId) throw new Error('Script Property DRIVE_FOLDER_ID が未設定です');
  _config = { sheetId: sheetId, folderId: folderId };
  return _config;
}
