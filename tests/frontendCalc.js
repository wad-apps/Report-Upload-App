// フロントエンド側の純粋計算関数（Node.js テスト用）
// dashboard.js の対応関数と同ロジックを維持する。
const { calcDailyOverKm } = require('./calc.js');

var OVER_KM_THRESHOLD = 100;

function getOcrRowClass(distance) {
  return (distance || 0) > OVER_KM_THRESHOLD ? 'over-km-row' : '';
}

// days: [{ start, distance, kosu }]
function calcSummaryStats(days) {
  var workingDays  = 0;
  var totalKosu    = 0;
  var totalDistance = 0;
  var totalOverKm  = 0;
  days.forEach(function(d) {
    var dist = Number(d.distance) || 0;
    var kosu = Number(d.kosu)     || 0;
    if (d.start && d.start.trim() !== '') workingDays++;
    totalDistance += dist;
    totalKosu     += kosu;
    totalOverKm   += calcDailyOverKm(dist);
  });
  return { workingDays: workingDays, totalKosu: totalKosu, totalDistance: totalDistance, totalOverKm: totalOverKm };
}

// rows: [{ day, fixedStart, fixedEnd, fixedKosu, fixedDistance }]
function buildCorrectionPayload(rows) {
  return rows.map(function(r) {
    return {
      day:           r.day,
      fixedStart:    r.fixedStart,
      fixedEnd:      r.fixedEnd,
      fixedKosu:     r.fixedKosu,
      fixedDistance: r.fixedDistance,
    };
  });
}

module.exports = { getOcrRowClass: getOcrRowClass, calcSummaryStats: calcSummaryStats, buildCorrectionPayload: buildCorrectionPayload };
