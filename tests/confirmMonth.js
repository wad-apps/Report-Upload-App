// 月次確定の集計ロジック（Node.js テスト用）
// GAS 側 handleAdminConfirmMonth_ の個数・距離・超過km集計と同ロジック
const { calcDailyOverKm } = require('./calc.js');

// ocrRows: 各要素は [fixedDistance, ocrDistance, fixedKosu, ocrKosu, isWorkingDay]
// 戻り値: { totalDistance, totalKosu, totalOverKm }
function calcMonthlyTotals(ocrRows) {
  var totalDistance = 0;
  var totalKosu     = 0;
  var totalOverKm   = 0;

  ocrRows.forEach(function(r) {
    var dist = (r[0] != null && r[0] !== '') ? Number(r[0]) : (Number(r[1]) || 0);
    var kosu = (r[2] != null && r[2] !== '') ? Number(r[2]) : (Number(r[3]) || 0);
    totalDistance += dist;
    totalKosu     += kosu;
    totalOverKm   += calcDailyOverKm(dist);
  });

  return { totalDistance: totalDistance, totalKosu: totalKosu, totalOverKm: totalOverKm };
}

module.exports = { calcMonthlyTotals: calcMonthlyTotals };
