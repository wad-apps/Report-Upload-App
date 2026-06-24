// writeOcrResults_ の行変換ロジック（Node.js テスト用）
// GAS 側の rows.map(function(d){...}) と同ロジックを保つ。

// d: { day, start, end, kosu, distance }
// ctx: { uid, name, site, yearMonth, fileId, uploadId }
// 戻り値: 17要素の配列（SHEET_OCR スキーマ [0]〜[16]）
function buildOcrRow(d, ctx) {
  var hasStartTime = d.start !== null && d.start !== undefined && d.start !== '';
  return [
    ctx.uid,              // [0]  LINEユーザーID
    ctx.name,             // [1]  ドライバー名
    ctx.site || '',       // [2]  現場名
    ctx.yearMonth,        // [3]  年月
    d.day,                // [4]  日
    d.start || '',        // [5]  開始時間
    d.end   || '',        // [6]  終了時間
    hasStartTime,         // [7]  稼働フラグ
    '未確認',              // [8]  確認ステータス
    '',                   // [9]  修正後開始時間
    '',                   // [10] 修正後終了時間
    ctx.fileId,           // [11] 受信ファイルID
    ctx.uploadId || '',   // [12] アップロードID
    (d.kosu     == null) ? '' : d.kosu,      // [13] 個数（OCR）
    (d.distance == null) ? '' : d.distance,  // [14] 走行距離(km)（OCR）
    '',                   // [15] 修正後個数（手入力用・空で初期化）
    '',                   // [16] 修正後走行距離（手入力用・空で初期化）
  ];
}

module.exports = { buildOcrRow: buildOcrRow };
