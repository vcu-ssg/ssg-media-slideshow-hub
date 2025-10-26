// ------------------------------------------------------------
// 🌦️ Weather API module – Node 22 (native fetch)
// ------------------------------------------------------------
export function createWeatherRouter(express, OPENWEATHER_KEY, log) {
  const router = express.Router();

  // --- Caches ---
  const weatherCache = new Map();
  const currentCache = new Map();
  const geoCache = new Map();
  const zipCache = new Map();

  // --- TTLs ---
  const FORECAST_TTL = 30 * 60 * 1000; // 30 min
  const CURRENT_TTL  = 10 * 60 * 1000; // 10 min
  const GEO_TTL      = 24 * 60 * 60 * 1000; // 24 hr
  const ZIP_TTL      = 24 * 60 * 60 * 1000; // 24 hr

  // --- US state map ---
  const STATE_NAMES = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
    CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
    HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
    KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
    MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
    MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
    NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
    OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
    SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
    VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
    WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia"
  };

  // Reverse lookup (full name → abbreviation)
  const STATE_ABBRS = Object.fromEntries(
    Object.entries(STATE_NAMES).map(([abbr, name]) => [name.toLowerCase(), abbr])
  );

  function getStateFullName(abbr) {
    return STATE_NAMES[abbr?.toUpperCase()] || abbr || "";
  }

  function getStateAbbr(nameOrAbbr) {
    if (!nameOrAbbr) return "";
    const key = nameOrAbbr.trim();
    if (STATE_NAMES[key.toUpperCase()]) return key.toUpperCase();
    const found = STATE_ABBRS[key.toLowerCase()];
    return found || "";
  }

  function getKey(lat, lon, units) {
    return `${lat},${lon},${units}`;
  }

  // ------------------------------------------------------------
  // 🗺️ Resolve coordinates for ZIP or City
  // ------------------------------------------------------------
  async function resolveCoords({ lat, lon, zip, city, state }) {
    if (lat && lon) return { lat, lon };
    if (!OPENWEATHER_KEY) throw new Error("Missing weather key");

    const lookup = zip ? `zip:${zip}` : `city:${city || ""},${state || ""}`;
    const cached = geoCache.get(lookup);
    if (cached && Date.now() - cached.ts < GEO_TTL) return cached.data;

    let coords;

    // --- ZIP via Zippopotam.us ---
    if (zip) {
      const cachedZip = zipCache.get(zip);
      if (cachedZip && Date.now() - cachedZip.ts < ZIP_TTL) {
        coords = cachedZip.data;
      } else {
        const zipUrl = `https://api.zippopotam.us/us/${zip}`;
        const zipRes = await fetch(zipUrl);
        if (!zipRes.ok) throw new Error(`ZIP lookup failed (${zipRes.status})`);
        const zipData = await zipRes.json();

        const place = zipData.places?.[0];
        if (!place) throw new Error(`No results for ZIP ${zip}`);

        const lat = parseFloat(place.latitude);
        const lon = parseFloat(place.longitude);
        const state_abbr = place["state abbreviation"];
        const state_name = STATE_NAMES[state_abbr] || "";
        const name = place["place name"];
        const country = zipData.country_abbreviation || "US";

        coords = { name, state_abbr, state_name, country, lat, lon, zip };
        zipCache.set(zip, { data: coords, ts: Date.now() });
      }
    }

    // --- City via OpenWeather direct geocoding ---
    else if (city) {
      let cityQuery = city.trim();
      const parts = cityQuery.split(",");
      // Ensure country is appended
      if (parts.length === 1) cityQuery += ",US";
      else if (parts.length === 2 && parts[1].trim().length === 2)
        cityQuery += ",US";

      const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(
        cityQuery
      )}&limit=1&appid=${OPENWEATHER_KEY}`;

      const r = await fetch(url);
      if (!r.ok) throw new Error(`Geocoding error ${r.status}`);
      const data = await r.json();
      if (!Array.isArray(data) || !data.length)
        throw new Error(`No geocoding results for "${city}"`);

      const item = data[0];
      // Handle long or short state names
      const abbr = getStateAbbr(item.state);
      const full = getStateFullName(abbr);

      coords = {
        name: item.name,
        state_abbr: abbr,
        state_name: full,
        country: item.country || "US",
        lat: item.lat,
        lon: item.lon
      };
    } else {
      throw new Error("No location parameters provided");
    }

    geoCache.set(lookup, { data: coords, ts: Date.now() });
    return coords;
  }

  // ------------------------------------------------------------
  // 🌡️ /api/weather/current
  // ------------------------------------------------------------
  router.get("/current", async (req, res) => {
    const { lat, lon, units, zip, city, state } = req.query;
    try {
      const coords = await resolveCoords({ lat, lon, zip, city, state });
      const cacheKey = getKey(coords.lat, coords.lon, units);
      const cached = currentCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < CURRENT_TTL) {
        log(`🌡️ Using cached current weather for ${cacheKey}`);
        return res.json(cached.data);
      }

      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${coords.lat}&lon=${coords.lon}&units=${
        units || "imperial"
      }&appid=${OPENWEATHER_KEY}`;

      const r = await fetch(url);
      const data = await r.json();
      if (r.ok) {
        data.name = coords.name || data.name;
        data.state_abbr = coords.state_abbr || "";
        data.state_name = coords.state_name || "";
        data.country = coords.country || data.sys?.country;
        currentCache.set(cacheKey, { data, ts: Date.now() });
      } else log(`⚠️ Current weather API error ${r.status}`);
      res.json(data);
    } catch (err) {
      console.error("❌ Current weather error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ------------------------------------------------------------
  // 🌤️ /api/weather (forecast)
  // ------------------------------------------------------------
  router.get("/", async (req, res) => {
    const { lat, lon, units, zip, city, state } = req.query;
    try {
      const coords = await resolveCoords({ lat, lon, zip, city, state });
      const cacheKey = getKey(coords.lat, coords.lon, units);
      const cached = weatherCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < FORECAST_TTL) {
        log(`🌤️ Using cached forecast for ${cacheKey}`);
        return res.json(cached.data);
      }

      const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${coords.lat}&lon=${coords.lon}&units=${
        units || "imperial"
      }&appid=${OPENWEATHER_KEY}`;

      const r = await fetch(url);
      const data = await r.json();
      if (r.ok) {
        if (!data.city) data.city = {};
        data.city.name = coords.name || data.city.name;
        data.city.state_abbr = coords.state_abbr || "";
        data.city.state_name = coords.state_name || "";
        data.city.country = coords.country || data.city.country;
        weatherCache.set(cacheKey, { data, ts: Date.now() });
      } else log(`⚠️ Forecast API error ${r.status}`);
      res.json(data);
    } catch (err) {
      console.error("❌ Forecast weather error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

