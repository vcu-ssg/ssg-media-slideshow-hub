// ------------------------------------------------------------
// 🌦️ Weather Underground Router (API v1)
// ------------------------------------------------------------
// Provides:
//
//   GET /api/v1/wunder/current
//   GET /api/v1/wunder/hourly
//   GET /api/v1/wunder/daily
//
// Automatically uses:
//
//   process.env.WUNDERGROUND_API_KEY
//   process.env.WUNDERGROUND_STATION_ID
//
// Uses built-in fetch (Node 22+) and shared logger.
// ------------------------------------------------------------

import { Router } from "express";
import { log } from "../../../shared/log.js";

// API key
const WU_KEY = process.env.WUNDERGROUND_API_KEY;
if (!WU_KEY) {
  console.warn("⚠️ Missing WUNDERGROUND_API_KEY (Weather Underground).");
}

// ------------------------------------------------------------
// Caches
// ------------------------------------------------------------

const currentCache = new Map();
const hourlyCache = new Map();
const dailyCache = new Map();
const geoCache = new Map();
const zipCache = new Map();

// TTL constants
const CURRENT_TTL = 10 * 60 * 1000;
const HOURLY_TTL = 30 * 60 * 1000;
const DAILY_TTL = 60 * 60 * 1000;
const GEO_TTL = 24 * 60 * 60 * 1000;
const ZIP_TTL = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------
// US state name mappings
// ------------------------------------------------------------

const STATE_NAMES = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",
  HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",
  KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",
  MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",
  NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",
  NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",
  OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",
  SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",
  VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",
  WY:"Wyoming",DC:"District of Columbia"
};

const STATE_ABBRS = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([abbr, name]) => [name.toLowerCase(), abbr])
);

const getStateAbbr = (x) =>
  STATE_NAMES[x?.toUpperCase()] ? x.toUpperCase() : STATE_ABBRS[x?.toLowerCase()] || "";

const getStateFull = (abbr) => STATE_NAMES[abbr?.toUpperCase()] || abbr || "";

const getKey = (lat, lon, units = "imperial") => `${lat},${lon},${units}`;

// ------------------------------------------------------------
// Geolocation helper: Zip / city+state → lat/lon
// ------------------------------------------------------------

async function resolveCoords({ lat, lon, zip, city, state }) {
  if (lat && lon) return { lat, lon };
  if (!WU_KEY) throw new Error("Missing WUNDERGROUND_API_KEY");

  const lookup = zip ? `zip:${zip}` : `city:${city || ""},${state || ""}`;
  const cached = geoCache.get(lookup);

  if (cached && Date.now() - cached.ts < GEO_TTL) return cached.data;

  let coords;

  // ZIP lookup path
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

  // City lookup path
  } else if (city) {
    const query = `${encodeURIComponent(city)},${encodeURIComponent(state || "VA")}`;
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${query},US&limit=1&appid=dummy`;

    const data = await (await fetch(url)).json();
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
  }

  geoCache.set(lookup, { data: coords, ts: Date.now() });
  return coords;
}

// Weather.com fetch helper
async function fetchWU(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`WU API error ${r.status}`);
  return r.json();
}

// ------------------------------------------------------------
// Build Router — default export
// ------------------------------------------------------------

const router = Router();

// ------------------------------------------------------------
// 🌡️ GET /api/v1/wunder/current
// ------------------------------------------------------------

router.get("/current", async (req, res) => {
  const stationId =
    req.query.stationId || process.env.WUNDERGROUND_STATION_ID;

  if (!stationId) {
    return res.status(400).json({ error: "Missing stationId" });
  }

  try {
    const cacheKey = stationId;
    const cached = currentCache.get(cacheKey);

    if (cached && Date.now() - cached.ts < CURRENT_TTL) {
      log(`🌡️ Cached WU current: ${stationId}`);
      return res.json(cached.data);
    }

    const url =
      `https://api.weather.com/v2/pws/observations/current?stationId=${stationId}&format=json&units=e&apiKey=${WU_KEY}`;

    const data = await fetchWU(url);

    currentCache.set(cacheKey, { data, ts: Date.now() });
    res.json(data);

  } catch (err) {
    log(`❌ WU current error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// 🕒 GET /api/v1/wunder/hourly
// ------------------------------------------------------------

router.get("/hourly", async (req, res) => {
  const { lat, lon, zip, city, state, units } = req.query;

  try {
    const coords = await resolveCoords({ lat, lon, zip, city, state });
    const cacheKey = getKey(coords.lat, coords.lon, units);

    const cached = hourlyCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < HOURLY_TTL) {
      log(`🕒 Cached WU hourly: ${cacheKey}`);
      return res.json(cached.data);
    }

    const url =
      `https://api.weather.com/v3/wx/forecast/hourly/24hour` +
      `?geocode=${coords.lat},${coords.lon}` +
      `&units=e&language=en-US&format=json&apiKey=${WU_KEY}`;

    const data = await fetchWU(url);

    data.city = {
      name: coords.name,
      state_abbr: coords.state_abbr,
      state_name: coords.state_name,
      country: coords.country,
    };

    hourlyCache.set(cacheKey, { data, ts: Date.now() });
    res.json(data);

  } catch (err) {
    log(`❌ WU hourly error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// 📅 GET /api/v1/wunder/daily
// ------------------------------------------------------------

router.get("/daily", async (req, res) => {
  const { lat, lon, zip, city, state, units } = req.query;

  try {
    const coords = await resolveCoords({ lat, lon, zip, city, state });
    const cacheKey = getKey(coords.lat, coords.lon, units);

    const cached = dailyCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < DAILY_TTL) {
      log(`📅 Cached WU daily: ${cacheKey}`);
      return res.json(cached.data);
    }

    const url =
      `https://api.weather.com/v3/wx/forecast/daily/5day` +
      `?geocode=${coords.lat},${coords.lon}` +
      `&units=e&language=en-US&format=json&apiKey=${WU_KEY}`;

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
    log(`❌ WU daily error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
