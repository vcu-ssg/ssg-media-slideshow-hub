// ------------------------------------------------------------
// 🌦️ Weather API module (OpenWeather + caching + geocoding)
// ------------------------------------------------------------

import { log } from "./utils.js"; // Optional: if you want logging reuse

// in Node 18+, you can delete the import above and rely on global fetch.

export function createWeatherRouter(express, OPENWEATHER_KEY) {
  const router = express.Router();

  // Caches
  const weatherCache = new Map();
  const currentCache = new Map();
  const geoCache = new Map();

  // TTLs
  const FORECAST_TTL = 30 * 60 * 1000; // 30 min
  const CURRENT_TTL = 10 * 60 * 1000;  // 10 min
  const GEO_TTL = 24 * 60 * 60 * 1000; // 24 hr

  // Helpers
  function getKey(lat, lon, units) {
    return `${lat},${lon},${units}`;
  }

  // ------------------------------------------------------------
  // 🗺️ Resolve coordinates via Direct Geocoding
  // ------------------------------------------------------------
  async function resolveCoords({ lat, lon, zip, city, state }) {
    if (lat && lon) return { lat, lon };
    if (!OPENWEATHER_KEY) throw new Error("Missing weather key");

    const lookup = zip ? `zip:${zip}` : `city:${city || ""},${state || ""}`;
    const cached = geoCache.get(lookup);
    if (cached && Date.now() - cached.ts < GEO_TTL) return cached.data;

    let url;
    if (zip) {
      url = `https://api.openweathermap.org/geo/1.0/zip?zip=${encodeURIComponent(
        zip
      )},US&appid=${OPENWEATHER_KEY}`;
    } else if (city) {
      url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(
        city + (state ? "," + state : "")
      )}&limit=1&appid=${OPENWEATHER_KEY}`;
    } else {
      throw new Error("No location parameters provided");
    }

    const r = await fetch(url);
    if (!r.ok) throw new Error(`Geocoding error ${r.status}`);
    const data = await r.json();

    let coords;
    if (Array.isArray(data) && data.length > 0) coords = data[0];
    else if (data.lat && data.lon) coords = data;
    else throw new Error("No geocoding results");

    geoCache.set(lookup, { data: coords, ts: Date.now() });
    return coords;
  }

  // ------------------------------------------------------------
  // 🌡️ Current weather endpoint
  // ------------------------------------------------------------
  router.get("/current", async (req, res) => {
    const { lat, lon, units, zip, city, state } = req.query;
    try {
      const coords = await resolveCoords({ lat, lon, zip, city, state });
      const cacheKey = getKey(coords.lat, coords.lon, units);
      const cached = currentCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < CURRENT_TTL) {
        log?.(`🌡️ Using cached current weather for ${cacheKey}`);
        return res.json(cached.data);
      }

      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${coords.lat}&lon=${coords.lon}&units=${
        units || "imperial"
      }&appid=${OPENWEATHER_KEY}`;

      const r = await fetch(url);
      const data = await r.json();
      if (r.ok) currentCache.set(cacheKey, { data, ts: Date.now() });
      else log?.(`⚠️ Current weather API error ${r.status}`);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ------------------------------------------------------------
  // 🌤️ Forecast weather endpoint
  // ------------------------------------------------------------
  router.get("/", async (req, res) => {
    const { lat, lon, units, zip, city, state } = req.query;
    try {
      const coords = await resolveCoords({ lat, lon, zip, city, state });
      const cacheKey = getKey(coords.lat, coords.lon, units);
      const cached = weatherCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < FORECAST_TTL) {
        log?.(`🌤️ Using cached forecast for ${cacheKey}`);
        return res.json(cached.data);
      }

      const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${coords.lat}&lon=${coords.lon}&units=${
        units || "imperial"
      }&appid=${OPENWEATHER_KEY}`;

      const r = await fetch(url);
      const data = await r.json();
      if (r.ok) weatherCache.set(cacheKey, { data, ts: Date.now() });
      else log?.(`⚠️ Forecast API error ${r.status}`);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
