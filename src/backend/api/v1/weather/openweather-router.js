// ------------------------------------------------------------
// 🌦️ OpenWeather Router (API v1)
// ------------------------------------------------------------
// Provides:
//
//   GET /api/v1/openweather/current
//   GET /api/v1/openweather/forecast
//
// Uses:
//   process.env.OPENWEATHER_API_KEY
//
// All endpoints support:
//   ?lat=...&lon=...&units=imperial
//   ?zip=23221
//   ?city=Richmond&state=VA
//
// Router follows Step 3 conventions used across API v1.
// ------------------------------------------------------------

import { Router } from "express";
import { log } from "../../../shared/log.js";

// ------------------------------------------------------------
// API key
// ------------------------------------------------------------
const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY;
if (!OPENWEATHER_KEY) {
  console.warn("⚠️ Missing OPENWEATHER_API_KEY (OpenWeather).");
}

// ------------------------------------------------------------
// Caches
// ------------------------------------------------------------

const weatherCache = new Map();  // forecast
const currentCache = new Map();  // current conditions
const geoCache = new Map();      // lat/lon lookup

// TTLs
const FORECAST_TTL = 30 * 60 * 1000; // 30 minutes
const CURRENT_TTL  = 10 * 60 * 1000; // 10 minutes
const GEO_TTL      = 24 * 60 * 60 * 1000; // 24 hours

const router = Router();

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function getKey(lat, lon, units = "imperial") {
  return `${lat},${lon},${units}`;
}

// ------------------------------------------------------------
// 🗺️ Resolve coordinates via OpenWeather Geocoding API
// ------------------------------------------------------------

async function resolveCoords({ lat, lon, zip, city, state }) {
  if (lat && lon) return { lat, lon };

  if (!OPENWEATHER_KEY) {
    throw new Error("Missing OPENWEATHER_API_KEY");
  }

  const lookup = zip ? `zip:${zip}` : `city:${city || ""},${state || ""}`;
  const cached = geoCache.get(lookup);

  if (cached && Date.now() - cached.ts < GEO_TTL) {
    return cached.data;
  }

  // ZIP-based geocoding
  if (zip) {
    const url = `https://api.openweathermap.org/geo/1.0/zip?zip=${encodeURIComponent(
      zip
    )},US&appid=${OPENWEATHER_KEY}`;

    const r = await fetch(url);
    if (!r.ok) throw new Error(`OpenWeather ZIP geocoding error ${r.status}`);

    const data = await r.json();
    if (!data.lat || !data.lon) throw new Error("ZIP lookup produced no results");

    geoCache.set(lookup, { data, ts: Date.now() });
    return data;
  }

  // City-based geocoding
  if (city) {
    const q = encodeURIComponent(city + (state ? "," + state : ""));
    const url =
      `https://api.openweathermap.org/geo/1.0/direct?q=${q}` +
      `&limit=1&appid=${OPENWEATHER_KEY}`;

    const r = await fetch(url);
    if (!r.ok) throw new Error(`OpenWeather city geocoding error ${r.status}`);

    const data = await r.json();
    const c = data?.[0];
    if (!c) throw new Error(`No geocoding results for city '${city}'`);

    const coords = { lat: c.lat, lon: c.lon, name: c.name, state: c.state };

    geoCache.set(lookup, { data: coords, ts: Date.now() });
    return coords;
  }

  throw new Error("Provide either lat/lon or zip or city");
}

// ------------------------------------------------------------
// 🌡️ Current weather → GET /api/v1/openweather/current
// ------------------------------------------------------------

router.get("/current", async (req, res) => {
  const { lat, lon, zip, city, state, units = "imperial" } = req.query;

  try {
    const coords = await resolveCoords({ lat, lon, zip, city, state });
    const cacheKey = getKey(coords.lat, coords.lon, units);

    const cached = currentCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CURRENT_TTL) {
      log(`🌡️ Cached OpenWeather current → ${cacheKey}`);
      return res.json(cached.data);
    }

    const url =
      `https://api.openweathermap.org/data/2.5/weather` +
      `?lat=${coords.lat}&lon=${coords.lon}` +
      `&units=${units}&appid=${OPENWEATHER_KEY}`;

    const r = await fetch(url);
    const data = await r.json();

    if (!r.ok) {
      log(`⚠️ OpenWeather /current error ${r.status}`);
      return res.status(r.status).json(data);
    }

    currentCache.set(cacheKey, { data, ts: Date.now() });
    res.json(data);

  } catch (err) {
    log(`❌ OpenWeather current error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// 🌤️ Forecast → GET /api/v1/openweather/forecast
// ------------------------------------------------------------

router.get("/forecast", async (req, res) => {
  const { lat, lon, zip, city, state, units = "imperial" } = req.query;

  try {
    const coords = await resolveCoords({ lat, lon, zip, city, state });
    const cacheKey = getKey(coords.lat, coords.lon, units);

    const cached = weatherCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < FORECAST_TTL) {
      log(`🌤️ Cached OpenWeather forecast → ${cacheKey}`);
      return res.json(cached.data);
    }

    const url =
      `https://api.openweathermap.org/data/2.5/forecast` +
      `?lat=${coords.lat}&lon=${coords.lon}` +
      `&units=${units}&appid=${OPENWEATHER_KEY}`;

    const r = await fetch(url);
    const data = await r.json();

    if (!r.ok) {
      log(`⚠️ OpenWeather /forecast error ${r.status}`);
      return res.status(r.status).json(data);
    }

    weatherCache.set(cacheKey, { data, ts: Date.now() });
    res.json(data);

  } catch (err) {
    log(`❌ OpenWeather forecast error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
