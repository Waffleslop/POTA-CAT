// Maidenhead grid square to lat/lon conversion and Haversine distance

function gridToLatLon(grid) {
  if (!grid || grid.length < 4) return null;
  const g = grid.toUpperCase();

  const lonField = g.charCodeAt(0) - 65;
  const latField = g.charCodeAt(1) - 65;
  const lonSquare = parseInt(g[2], 10);
  const latSquare = parseInt(g[3], 10);

  let lon = lonField * 20 + lonSquare * 2 - 180;
  let lat = latField * 10 + latSquare * 1 - 90;

  if (grid.length >= 6) {
    const lonSub = g.charCodeAt(4) - 65;
    const latSub = g.charCodeAt(5) - 65;
    lon += lonSub * (2 / 24) + (1 / 24);
    lat += latSub * (1 / 24) + (1 / 48);
  } else {
    lon += 1;
    lat += 0.5;
  }

  return { lat, lon };
}

function haversineDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth radius in miles
  const toRad = (deg) => deg * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => deg * Math.PI / 180;
  const toDeg = (rad) => rad * 180 / Math.PI;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function latLonToGrid(lat, lon) {
  let lng = lon + 180;
  let la = lat + 90;
  const A = 'A'.charCodeAt(0);
  const a = 'a'.charCodeAt(0);
  const field1 = String.fromCharCode(A + Math.floor(lng / 20));
  const field2 = String.fromCharCode(A + Math.floor(la / 10));
  lng %= 20;
  la %= 10;
  const sq1 = Math.floor(lng / 2);
  const sq2 = Math.floor(la / 1);
  lng -= sq1 * 2;
  la -= sq2 * 1;
  const sub1 = String.fromCharCode(a + Math.floor(lng / (2 / 24)));
  const sub2 = String.fromCharCode(a + Math.floor(la / (1 / 24)));
  return `${field1}${field2}${sq1}${sq2}${sub1}${sub2}`;
}

module.exports = { gridToLatLon, latLonToGrid, haversineDistanceMiles, bearing };
