/* ============================================================================
 * geo.ts - IP + approximate location resolution.
 *
 * A production build would call an IP-geolocation service from the server
 * (the client cannot be trusted for this). Since this demo has no backend we
 * model the same contract locally: an IP resolver that returns an
 * ip / city / region / country tuple, with a test console so the "new city"
 * security rule can actually be triggered on demand.
 * ==========================================================================*/
import type { GeoLocation } from '../types';

const GEO_KEY = 'nexstream:geo:current';

/** Data-centre style pool used to simulate egress IPs. */
const IP_POOL: GeoLocation[] = [
  { ip: '49.36.184.22', city: 'Mumbai', region: 'Maharashtra', country: 'India', label: 'Mumbai, Maharashtra, India', simulated: true },
  { ip: '103.21.58.14', city: 'Pune', region: 'Maharashtra', country: 'India', label: 'Pune, Maharashtra, India', simulated: true },
  { ip: '157.32.10.9', city: 'Bengaluru', region: 'Karnataka', country: 'India', label: 'Bengaluru, Karnataka, India', simulated: true },
  { ip: '223.185.44.71', city: 'Delhi', region: 'Delhi', country: 'India', label: 'New Delhi, Delhi, India', simulated: true },
  { ip: '106.51.72.140', city: 'Chennai', region: 'Tamil Nadu', country: 'India', label: 'Chennai, Tamil Nadu, India', simulated: true },
  { ip: '182.68.19.33', city: 'Jaipur', region: 'Rajasthan', country: 'India', label: 'Jaipur, Rajasthan, India', simulated: true },
  { ip: '13.234.52.180', city: 'Singapore', region: 'Singapore', country: 'Singapore', label: 'Singapore, Singapore, Singapore', simulated: true },
];

function pick(): GeoLocation {
  return IP_POOL[Math.floor(Math.random() * IP_POOL.length)];
}

/**
 * Resolve the caller's public IP + approximate location.
 * Values persist for the tab session so a single visit is internally
 * consistent (the same IP appears on the login record and on every download).
 */
export function resolveGeoLocation(forceNew = false): GeoLocation {
  if (forceNew) {
    const fresh = pick();
    sessionStorage.setItem(GEO_KEY, JSON.stringify(fresh));
    return fresh;
  }
  const cached = sessionStorage.getItem(GEO_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as GeoLocation;
    } catch {
      /* fall through and re-resolve */
    }
  }
  const resolved = pick();
  sessionStorage.setItem(GEO_KEY, JSON.stringify(resolved));
  return resolved;
}

/** Current IP without any lat/long lookup - used for audit rows. */
export function currentIp(): string {
  return resolveGeoLocation().ip;
}

/**
 * Test console helper: pretend the next request comes from a different city so
 * the "login from a new city triggers OTP" rule can be demonstrated.
 */
export function simulateLocation(geo: GeoLocation): GeoLocation {
  sessionStorage.setItem(GEO_KEY, JSON.stringify(geo));
  return geo;
}

export function geoOptions(): GeoLocation[] {
  return IP_POOL;
}
