// フロント共通設定。値の変更はこのファイルだけを編集する。
// 注意: ここに置く値はすべて公開前提（ブラウザに必ず送られる）。
//       秘密情報（APIキー等）は絶対に書かない。
window.APP_CONFIG = {
  // ドライバー・事務員 共通
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxhBY8vJ74CzghhEfnZi1QitH1U0qeOFfQ-aEG8Z9bfIchXqHLDBF3BEmFEKdSma3dJTw/exec',

  // ドライバー（LIFF）用
  LIFF_ID: '2010213495-32sSJXPi',
  TAG_REDIRECT_URL: '', // Lステップ流入URL。設定するまで liff.closeWindow() にフォールバック

  // 事務員ダッシュボード（Google Sign-In）用
  OAUTH_CLIENT_ID: '882266271532-67lvpq4lk25qgr9npdt4f1n0o07afuq1.apps.googleusercontent.com',
};
