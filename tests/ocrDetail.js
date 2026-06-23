// OCR詳細行の変換ロジック（Node.js テスト用）
// GAS 側の handleAdminGetOcrDetail_ と同じ変換を持つ。
const { calcDailyOverKm } = require('./calc.js');

// SHEET_OCR の1行を day エントリオブジェクトに変換する
// row: [0]uid [1]name [2]site [3]ym [4]day [5]start [6]end [7]isWorking [8]status
//      [9]fixedStart [10]fixedEnd [11]fileId [12]uploadId
//      [13]ocrKosu [14]ocrDistance [15]fixedKosu [16]fixedDistance
function buildDayEntry(row) {
  var fixedKosu     = (row[15] !== null && row[15] !== '') ? row[15] : null;
  var ocrKosu       = (row[13] !== null && row[13] !== '') ? row[13] : null;
  var fixedDistance = (row[16] !== null && row[16] !== '') ? row[16] : null;
  var ocrDistance   = (row[14] !== null && row[14] !== '') ? row[14] : null;

  var kosu     = fixedKosu     != null ? Number(fixedKosu)     : (ocrKosu     != null ? Number(ocrKosu)     : 0);
  var distance = fixedDistance != null ? Number(fixedDistance) : (ocrDistance != null ? Number(ocrDistance) : 0);

  return {
    day:        row[4],
    start:      row[5] || '',
    end:        row[6] || '',
    isWorking:  row[7],
    status:     row[8] || '',
    fixedStart: row[9]  || '',
    fixedEnd:   row[10] || '',
    kosu:       kosu,
    distance:   distance,
    overKm:     calcDailyOverKm(distance),
  };
}

module.exports = { buildDayEntry: buildDayEntry };
