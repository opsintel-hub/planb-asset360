// OSRM (Open Source Routing Machine) client utilities.
// Uses the public demo server at router.project-osrm.org.
// Note: The public demo has rate limits and no SLA — for production, host your own.

export type LatLng = [number, number]; // [lat, lng]

const OSRM_BASE = "https://router.project-osrm.org";

// Decode Google/OSRM encoded polyline (precision 5 by default, OSRM uses 5 too when overview=full/simplified)
export function decodePolyline(str: string, precision = 5): LatLng[] {
  let index = 0;
  const len = str.length;
  const coords: LatLng[] = [];
  let lat = 0;
  let lng = 0;
  const factor = Math.pow(10, precision);
  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    coords.push([lat / factor, lng / factor]);
  }
  return coords;
}

export type OsrmLeg = { distance: number; duration: number };

export type OsrmRouteResult = {
  geometry: LatLng[]; // decoded polyline
  distance: number; // meters
  duration: number; // seconds
  legs: OsrmLeg[]; // per-segment distance/duration (length = points.length - 1)
};

// Fetch a driving route through the given waypoints in the given order.
export async function osrmRoute(points: LatLng[]): Promise<OsrmRouteResult> {
  if (points.length < 2) throw new Error("need at least 2 points");
  const coords = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=polyline`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM route failed: ${res.status}`);
  const j = await res.json();
  if (j.code !== "Ok" || !j.routes?.length) throw new Error(j.message || "OSRM: no route");
  const r = j.routes[0];
  return {
    geometry: decodePolyline(r.geometry, 5),
    distance: r.distance,
    duration: r.duration,
    legs: (r.legs ?? []).map((l: { distance: number; duration: number }) => ({ distance: l.distance, duration: l.duration })),
  };
}

export type OsrmTripResult = OsrmRouteResult & {
  waypointOrder: number[]; // maps input index -> visit order (0-based). Length = points.length
};

// Solve TSP through waypoints using OSRM /trip. Source=first, roundtrip configurable.
export async function osrmTrip(points: LatLng[], opts: {
  roundtrip?: boolean;
  fixedStart?: boolean;
  fixedEnd?: boolean;
} = {}): Promise<OsrmTripResult> {
  if (points.length < 2) throw new Error("need at least 2 points");
  const coords = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const params = new URLSearchParams({
    overview: "full",
    geometries: "polyline",
    roundtrip: String(opts.roundtrip ?? false),
    source: opts.fixedStart ? "first" : "any",
    destination: opts.fixedEnd ? "last" : "any",
  });
  const url = `${OSRM_BASE}/trip/v1/driving/${coords}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM trip failed: ${res.status}`);
  const j = await res.json();
  if (j.code !== "Ok" || !j.trips?.length) throw new Error(j.message || "OSRM: no trip");
  const trip = j.trips[0];
  // waypoints[i].waypoint_index is the visit order for input index i
  const order = (j.waypoints as Array<{ waypoint_index: number }>).map((w) => w.waypoint_index);
  return {
    geometry: decodePolyline(trip.geometry, 5),
    distance: trip.distance,
    duration: trip.duration,
    waypointOrder: order,
  };
}

// ---------- GPX / KML ----------

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export type ExportWaypoint = {
  lat: number;
  lng: number;
  name?: string | null;
  description?: string | null;
};

export function buildGpx(routeName: string, track: LatLng[], waypoints: ExportWaypoint[] = []): string {
  const wptXml = waypoints
    .map(
      (w) =>
        `  <wpt lat="${w.lat}" lon="${w.lng}"><name>${xmlEscape(w.name ?? "")}</name>${
          w.description ? `<desc>${xmlEscape(w.description)}</desc>` : ""
        }</wpt>`,
    )
    .join("\n");
  const trkptXml = track.map(([lat, lng]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Asset History 360" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xmlEscape(routeName)}</name></metadata>
${wptXml}
  <trk><name>${xmlEscape(routeName)}</name><trkseg>
${trkptXml}
  </trkseg></trk>
</gpx>`;
}

export function buildKml(routeName: string, track: LatLng[], waypoints: ExportWaypoint[] = []): string {
  const wptXml = waypoints
    .map(
      (w) => `    <Placemark>
      <name>${xmlEscape(w.name ?? "")}</name>
      ${w.description ? `<description>${xmlEscape(w.description)}</description>` : ""}
      <Point><coordinates>${w.lng},${w.lat},0</coordinates></Point>
    </Placemark>`,
    )
    .join("\n");
  const coordStr = track.map(([lat, lng]) => `${lng},${lat},0`).join(" ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xmlEscape(routeName)}</name>
    <Style id="line"><LineStyle><color>ff1d4ed8</color><width>4</width></LineStyle></Style>
${wptXml}
    <Placemark>
      <name>${xmlEscape(routeName)}</name>
      <styleUrl>#line</styleUrl>
      <LineString><tessellate>1</tessellate><coordinates>${coordStr}</coordinates></LineString>
    </Placemark>
  </Document>
</kml>`;
}

export function downloadText(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Build a Google Maps directions URL for up to ~10 waypoints.
export function googleMapsDirectionsUrl(points: LatLng[]): string {
  if (points.length < 2) return "";
  const [origin, ...rest] = points;
  const dest = rest[rest.length - 1];
  const via = rest.slice(0, -1);
  const params = new URLSearchParams({
    api: "1",
    travelmode: "driving",
    origin: `${origin[0]},${origin[1]}`,
    destination: `${dest[0]},${dest[1]}`,
  });
  if (via.length) params.set("waypoints", via.map(([la, ln]) => `${la},${ln}`).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// Alternate Google Maps host (some corporate networks block www.google.com but allow google.co.th).
export function googleMapsAltDirectionsUrl(points: LatLng[]): string {
  const u = googleMapsDirectionsUrl(points);
  return u ? u.replace("www.google.com", "www.google.co.th") : "";
}

// Apple Maps directions (iOS/macOS). Only supports single origin -> destination.
export function appleMapsDirectionsUrl(points: LatLng[]): string {
  if (points.length < 2) return "";
  const o = points[0];
  const d = points[points.length - 1];
  const params = new URLSearchParams({
    saddr: `${o[0]},${o[1]}`,
    daddr: `${d[0]},${d[1]}`,
    dirflg: "d",
  });
  return `https://maps.apple.com/?${params.toString()}`;
}

// OpenStreetMap directions (OSRM engine).
export function osmDirectionsUrl(points: LatLng[]): string {
  if (points.length < 2) return "";
  const route = points.map(([la, ln]) => `${la}%2C${ln}`).join("%3B");
  const o = points[0];
  const d = points[points.length - 1];
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${route}#map=13/${o[0]}/${o[1]}`;
}

// Waze — navigate to the final destination (Waze URL only supports one destination).
export function wazeNavigateUrl(points: LatLng[]): string {
  if (points.length < 1) return "";
  const d = points[points.length - 1];
  return `https://www.waze.com/ul?ll=${d[0]}%2C${d[1]}&navigate=yes`;
}

