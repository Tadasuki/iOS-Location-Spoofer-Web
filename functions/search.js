/**
 * Server-side geocoding proxy.
 * Keeps provider keys out of the browser and avoids cross-origin failures on iOS.
 */

import { authOk, jsonResponse, errorResponse, corsHeaders } from './_utils.js';

const MAX_RESULTS = 8;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function searchAmap(query, key) {
  const url = new URL('https://restapi.amap.com/v3/place/text');
  url.searchParams.set('keywords', query);
  url.searchParams.set('offset', String(MAX_RESULTS));
  url.searchParams.set('page', '1');
  url.searchParams.set('extensions', 'base');
  url.searchParams.set('key', key);

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`amap ${response.status}`);

  const data = await response.json();
  if (data.status !== '1' || !Array.isArray(data.pois)) return [];

  return data.pois.flatMap((poi) => {
    if (typeof poi.location !== 'string') return [];
    const [longitude, latitude] = poi.location.split(',').map(Number);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    const address = [clean(poi.pname), clean(poi.cityname), clean(poi.adname), clean(poi.address)]
      .filter(Boolean)
      .join(' · ');
    return [{
      name: clean(poi.name) || query,
      address,
      latitude,
      longitude,
      coordinateSystem: 'gcj02',
      source: 'amap'
    }];
  });
}

async function searchOpenStreetMap(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', String(MAX_RESULTS));
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('accept-language', 'zh-CN,zh,en');

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
      'User-Agent': 'iOS-Location-Spoofer-Web/1.0 (https://github.com/Tadasuki/iOS-Location-Spoofer-Web)'
    }
  });
  if (!response.ok) throw new Error(`nominatim ${response.status}`);

  const data = await response.json();
  if (!Array.isArray(data)) return [];

  return data.flatMap((place) => {
    const latitude = Number(place.lat);
    const longitude = Number(place.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    const displayName = clean(place.display_name);
    const parts = displayName.split(',').map((part) => part.trim()).filter(Boolean);
    return [{
      name: clean(place.name) || parts[0] || query,
      address: parts.slice(clean(place.name) ? 0 : 1, 4).join(' · '),
      latitude,
      longitude,
      coordinateSystem: 'wgs84',
      source: 'openstreetmap'
    }];
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!authOk(request, env)) return errorResponse('unauthorized', 401);

  const query = clean(new URL(request.url).searchParams.get('q'));
  if (query.length < 2) return errorResponse('query too short', 400);
  if (query.length > 120) return errorResponse('query too long', 400);

  try {
    let results = [];
    if (env.AMAP_KEY) {
      try {
        results = await searchAmap(query, env.AMAP_KEY);
      } catch (_) {
        // Fall through to the international provider.
      }
    }
    if (!results.length) results = await searchOpenStreetMap(query);
    return jsonResponse({ results });
  } catch (error) {
    return errorResponse('search provider unavailable', 502);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
