// 純粋計算関数（Node.js テスト用）
// GAS 側の実装（Dashboard.gs の calcDailyOverKm_ / calcMonthlyStats_）と同ロジックを保つ。

var OVER_KM_THRESHOLD = 100;

function calcDailyOverKm(distance) {
  return Math.max(0, (distance || 0) - OVER_KM_THRESHOLD);
}

// ocrRows: 各要素は [fixedDistance, ocrDistance, fixedKosu, ocrKosu]
// fixedXxx が null / '' / 0 なら ocrXxx を採用（0 はありえないので falsy で判定）
function calcMonthlyStats(ocrRows) {
  var totalDistance = 0;
  var totalKosu     = 0;
  var totalOverKm   = 0;

  ocrRows.forEach(function(r) {
    var dist = (r[0] != null && r[0] !== '') ? r[0] : (r[1] || 0);
    var kosu = (r[2] != null && r[2] !== '') ? r[2] : (r[3] || 0);
    totalDistance += dist;
    totalKosu     += kosu;
    totalOverKm   += calcDailyOverKm(dist);
  });

  return { totalDistance: totalDistance, totalKosu: totalKosu, totalOverKm: totalOverKm };
}

module.exports = { calcDailyOverKm: calcDailyOverKm, calcMonthlyStats: calcMonthlyStats };
