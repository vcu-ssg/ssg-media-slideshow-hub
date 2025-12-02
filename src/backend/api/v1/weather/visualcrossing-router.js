// ------------------------------------------------------------
// 🌦️ Visual Crossing Router (API v1)
// ------------------------------------------------------------
//
// Endpoints:
//   GET /api/v1/visualcrossing/current
//   GET /api/v1/visualcrossing/hourly
//   GET /api/v1/visualcrossing/daily
//
// Supports:
//   ?lat=&lon=
//   ?zip=
//   ?city=
//
// Uses environment variable:
//   VISUALCROSSING_KEY
//
// Router follows Step 3 conventions across weather modules.
// ------------------------------------------------------------

import { Router } from "express";
import { log } from "../../../shared/log.js";

// ------------------------------------------------------------
// API Key
// ------------------------------------------------------------
const VC_KEY = process.env.VISUALCROSSING_KEY;
if (!VC_KEY) {
  console.warn("⚠️ Missing VISUALCROSSING_KEY environment variable.");
}

const router = Router();

// ------------------------------------------------------------
// Cache + TTLs
// ------------------------------------------------------------
const cache = new Map();
const TTL = {
  CURRENT: 10 * 60 * 1000, // 10 minutes
  HOURLY: 30 * 60 * 1000,  // 30 minutes
  DAILY: 30 * 60 * 1000,
  GEO: 24 * 60 * 60 * 1000
};

// ------------------------------------------------------------
// 🗺️ Resolve coordinates via ZIP / lat/lon / city
// ------------------------------------------------------------
async function resolveCoords({ lat, lon, zip, city }) {
  // Direct lat/lon
  if (lat && lon) return { lat: Number(lat), lon: Number(lon) };

  // ZIP → lat/lon (VisualCrossing prefers coords)
  if (zip) {
    const key = `zip:${zip}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < TTL.GEO) {
      return cached.data;
    }

    const r = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!r.ok) throw new Error(`ZIP lookup failed (${r.status})`);

    const z = await r.json();
    const p = z.places?.[0];
    if (!p) throw new Error(`ZIP ${zip} not found`);

    const data = {
      lat: Number(p.latitude),
      lon: Number(p.longitude),
      name: p["place name"],
      state_abbr: p["state abbreviation"],
      state_name: p.state,
      country: z.country_abbreviation
    };

    cache.set(key, { data, ts: Date.now() });
    return data;
  }

  // City/state — Visual Crossing will interpret "City,ST"
  if (city) return { city };

  throw new Error("No location parameters provided");
}

// ------------------------------------------------------------
// 🔗 Helper: Build VC URL
// ------------------------------------------------------------
function vcUrl({ lat, lon, city, zip, units }) {
  const loc = zip
    ? zip
    : city
    ? encodeURIComponent(city)
    : `${lat},${lon}`;

  const base =
    `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${loc}`;

  const params = new URLSearchParams({
    unitGroup: units === "metric" ? "metric" : "us",
    include: "current,days,hours",
    contentType: "json",
    key: VC_KEY
  });

  return `${base}?${params.toString()}`;
}

// ------------------------------------------------------------
// 🌡️ GET /api/v1/visualcrossing/current
// ------------------------------------------------------------
router.get("/current", async (req, res) => {
  const { lat, lon, zip, city, units } = req.query;

  try {
    const coords = await resolveCoords({ lat, lon, zip, city });
    const key = `current:${coords.lat},${coords.lon},${units}`;
    const cached = cache.get(key);

    if (cached && Date.now() - cached.ts < TTL.CURRENT) {
      return res.json(cached.data);
    }

    const r = await fetch(vcUrl({ ...coords, zip, city, units }));
    const data = await r.json();
    if (!r.ok) throw new Error(`VC current error ${r.status}`);

    const payload = {
      ...data.currentConditions,
      city: {
        name: coords.name,
        state_abbr: coords.state_abbr,
        state_name: coords.state_name,
        country: coords.country
      },
      resolvedAddress: data.resolvedAddress
    };

    cache.set(key, { data: payload, ts: Date.now() });
    res.json(payload);

  } catch (err) {
    log(`❌ VisualCrossing /current error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// 🕒 GET /api/v1/visualcrossing/hourly
// ------------------------------------------------------------
router.get("/hourly", async (req, res) => {
  const { lat, lon, zip, city, units } = req.query;

  try {
    const coords = await resolveCoords({ lat, lon, zip, city });
    const key = `hourly:${coords.lat},${coords.lon},${units}`;
    const cached = cache.get(key);

    if (cached && Date.now() - cached.ts < TTL.HOURLY) {
      return res.json(cached.data);
    }

    const r = await fetch(vcUrl({ ...coords, zip, city, units }));
    const data = await r.json();
    if (!r.ok) throw new Error(`VC hourly error ${r.status}`);

    const hours = data.days?.flatMap((d) =>
      d.hours.map((h) => ({
        datetime: `${d.datetime}T${h.datetime}`,
        temp: h.temp,
        feelslike: h.feelslike,
        humidity: h.humidity,
        precipprob: h.precipprob,
        precip: h.precip,
        windspeed: h.windspeed,
        winddir: h.winddir,
        icon: h.icon,
        conditions: h.conditions
      }))
    );

    const payload = {
      city: {
        name: coords.name,
        state_abbr: coords.state_abbr,
        state_name: coords.state_name,
        country: coords.country
      },
      resolvedAddress: data.resolvedAddress,
      hours
    };

    cache.set(key, { data: payload, ts: Date.now() });
    res.json(payload);

  } catch (err) {
    log(`❌ VisualCrossing /hourly error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// 🌤️ GET /api/v1/visualcrossing/daily
// ------------------------------------------------------------
router.get("/daily", async (req, res) => {
  const { lat, lon, zip, city, units } = req.query;

  try {
    const coords = await resolveCoords({ lat, lon, zip, city });
    const key = `daily:${coords.lat},${coords.lon},${units}`;
    const cached = cache.get(key);

    if (cached && Date.now() - cached.ts < TTL.DAILY) {
      return res.json(cached.data);
    }

    const r = await fetch(vcUrl({ ...coords, zip, city, units }));
    const data = await r.json();
    if (!r.ok) throw new Error(`VC daily error ${r.status}`);

    const days = data.days?.map((d) => ({
      datetime: d.datetime,
      tempmax: d.tempmax,
      tempmin: d.tempmin,
      temp: d.temp,
      humidity: d.humidity,
      precipprob: d.precipprob,
      precip: d.precip,
      windspeed: d.windspeed,
      winddir: d.winddir,
      icon: d.icon,
      conditions: d.conditions
    }));

    const payload = {
      city: {
        name: coords.name,
        state_abbr: coords.state_abbr,
        state_name: coords.state_name,
        country: coords.country
      },
      resolvedAddress: data.resolvedAddress,
      days
    };

    cache.set(key, { data: payload, ts: Date.now() });
    res.json(payload);

  } catch (err) {
    log(`❌ VisualCrossing /daily error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
