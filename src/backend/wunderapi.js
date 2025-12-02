// ------------------------------------------------------------
// 🌦️ Weather Underground (Weather Company) API router
// ------------------------------------------------------------
import fetch from "node-fetch";

export function createWunderRouter(express, WU_KEY, log) {
  const router = express.Router();

  // --- Caches ---
  const currentCache = new Map();
  const hourlyCache = new Map();
  const dailyCache = new Map();
  const geoCache = new Map();
  const zipCache = new Map();

  // --- TTLs ---
  const CURRENT_TTL = 10 * 60 * 1000;
  const HOURLY_TTL  = 30 * 60 * 1000;
  const DAILY_TTL   = 60 * 60 * 1000;
  const GEO_TTL     = 24 * 60 * 60 * 1000;
  const ZIP_TTL     = 24 * 60 * 60 * 1000;

  // --- US state map (same as your weatherapi.js) ---
  const STATE_NAMES = {
    AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",
    CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",
    IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",
    ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",
    MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",
    NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",
    NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",
    PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",
    TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",
    WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",DC:"District of Columbia"
  };
  const STATE_ABBRS = Object.fromEntries(
    Object.entries(STATE_NAMES).map(([abbr, name]) => [name.toLowerCase(), abbr])
  );
  const getStateAbbr = (x) =>
    STATE_NAMES[x?.toUpperCase()] ? x.toUpperCase() : STATE_ABBRS[x?.toLowerCase()] || "";
  const getStateFull = (abbr) => STATE_NAMES[abbr?.toUpperCase()] || abbr || "";

  const getKey = (lat, lon, units="imperial") => `${lat},${lon},${units}`;

  // ------------------------------------------------------------
  // 🗺️ Resolve coordinates (zip → lat/lon) like weatherapi.js
  // ------------------------------------------------------------
  async function resolveCoords({ lat, lon, zip, city, state }) {
    if (lat && lon) return { lat, lon };
    if (!WU_KEY) throw new Error("Missing WU API key");

    const lookup = zip ? `zip:${zip}` : `city:${city || ""},${state || ""}`;
    const cached = geoCache.get(lookup);
    if (cached && Date.now() - cached.ts < GEO_TTL) return cached.data;

    let coords;

    if (zip) {
      const cachedZip = zipCache.get(zip);
      if (cachedZip && Date.now() - cachedZip.ts < ZIP_TTL) {
        coords = cachedZip.data;
      } else {
        const r = await fetch(`https://api.zippopotam.us/us/${zip}`);
        if (!r.ok) throw new Error(`ZIP lookup failed ${r.status}`);
        const data = await r.json();
        const place = data.places?.[0];
        if (!place) throw new Error(`No results for ZIP ${zip}`);
        const state_abbr = place["state abbreviation"];
        coords = {
          name: place["place name"],
          state_abbr,
          state_name: STATE_NAMES[state_abbr],
          country: data.country_abbreviation,
          lat: parseFloat(place.latitude),
          lon: parseFloat(place.longitude),
          zip,
        };
        zipCache.set(zip, { data: coords, ts: Date.now() });
      }
    } else if (city) {
      const query = `${encodeURIComponent(city)},${encodeURIComponent(state||"VA")}`;
      const r = await fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${query},US&limit=1&appid=dummy`);
      const data = await r.json();
      const c = data?.[0];
      if (!c) throw new Error(`No geocode for ${city}`);
      const abbr = getStateAbbr(c.state);
      coords = {
        name: c.name,
        state_abbr: abbr,
        state_name: getStateFull(abbr),
        country: c.country || "US",
        lat: c.lat,
        lon: c.lon,
      };
    } else {
      throw new Error("No location parameters provided");
    }

    geoCache.set(lookup, { data: coords, ts: Date.now() });
    return coords;
  }

  async function fetchWU(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`WU API error ${r.status}`);
    return r.json();
  }

  // ------------------------------------------------------------
  // 🌡️ /api/wunder/current  (PWS observations)
  // ------------------------------------------------------------
  router.get("/current", async (req, res) => {
    const { stationId = process.env.WUNDERGROUND_STATION_ID } = req.query;
    try {
      const cacheKey = stationId;
      const cached = currentCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < CURRENT_TTL) {
        log(`🌡️ Using cached WU current for ${stationId}`);
        return res.json(cached.data);
      }
      const url = `https://api.weather.com/v2/pws/observations/current?stationId=${stationId}&format=json&units=e&apiKey=${WU_KEY}`;
      const data = await fetchWU(url);
      currentCache.set(cacheKey, { data, ts: Date.now() });
      res.json(data);
    } catch (err) {
      console.error("❌ WU current error:", err);
      res.status(500).json({ error: err.message });
    }
  });

// ------------------------------------------------------------
// 🕒 /api/wunder/hourly  (24-hour forecast)
// ------------------------------------------------------------
router.get("/hourly", async (req, res) => {
  const { lat, lon, zip, city, state, units } = req.query;
  try {
    const coords = await resolveCoords({ lat, lon, zip, city, state });
    const cacheKey = getKey(coords.lat, coords.lon, units);
    const cached = hourlyCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < HOURLY_TTL) {
      log(`🕒 Using cached WU hourly for ${cacheKey}`);
      return res.json(cached.data);
    }

    // ✅ use 24-hour endpoint instead of 48-hour
    const url = `https://api.weather.com/v3/wx/forecast/hourly/24hour?geocode=${coords.lat},${coords.lon}&units=e&language=en-US&format=json&apiKey=${WU_KEY}`;
    const data = await fetchWU(url);

    // Attach metadata for consistency
    data.city = {
      name: coords.name,
      state_abbr: coords.state_abbr,
      state_name: coords.state_name,
      country: coords.country,
    };

    hourlyCache.set(cacheKey, { data, ts: Date.now() });
    res.json(data);
  } catch (err) {
    console.error("❌ WU hourly error:", err);
    res.status(500).json({ error: err.message });
  }
});

  

  // ------------------------------------------------------------
  // 📅 /api/wunder/daily  (5-day forecast)
  // ------------------------------------------------------------
  router.get("/daily", async (req, res) => {
    const { lat, lon, zip, city, state, units } = req.query;
    try {
      const coords = await resolveCoords({ lat, lon, zip, city, state });
      const cacheKey = getKey(coords.lat, coords.lon, units);
      const cached = dailyCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < DAILY_TTL) {
        log(`📅 Using cached WU daily for ${cacheKey}`);
        return res.json(cached.data);
      }

      const url = `https://api.weather.com/v3/wx/forecast/daily/5day?geocode=${coords.lat},${coords.lon}&units=e&language=en-US&format=json&apiKey=${WU_KEY}`;
      const data = await fetchWU(url);
      data.city = {
        name: coords.name,
        state_abbr: coords.state_abbr,
        state_name: coords.state_name,
        country: coords.country,
      };
      dailyCache.set(cacheKey, { data, ts: Date.now() });
      res.json(data);
    } catch (err) {
      console.error("❌ WU daily error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
