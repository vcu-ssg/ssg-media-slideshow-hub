// ------------------------------------------------------------
// 🌦️ Meteobridge Router (PRO2) → OpenWeather-style JSON + Raw/XML Access
// ------------------------------------------------------------
// Routes:
//   GET /api/meteobridge/current       → Cached normalized data (imperial)
//   GET /api/meteobridge/current_rt    → Real-time normalized data
//   GET /api/meteobridge/recent        → Cached historical data
//   GET /api/meteobridge/raw           → Unmodified JSON (uncached)
//   GET /api/meteobridge/xml           → Raw XML string (uncached)
// ------------------------------------------------------------

import express from "express";
import fetch from "node-fetch";
import xml2js from "xml2js";

/** °C → °F */
function cToF(c) {
  if (c === null || c === undefined || isNaN(c)) return null;
  return (c * 9) / 5 + 32;
}

/** m/s → mph */
function msToMph(ms) {
  if (ms === null || ms === undefined || isNaN(ms)) return null;
  return ms * 2.23694;
}

/** hPa → inches of mercury */
function hPaToInHg(hPa) {
  if (hPa === null || hPa === undefined || isNaN(hPa)) return null;
  return hPa * 0.02953;
}

export function createMeteobridgeRouter({
  host,
  username,
  password,
  cacheTTL = 30,
  log = console.log,
} = {}) {
  const router = express.Router();

  if (!host || !username || !password)
    throw new Error("createMeteobridgeRouter() requires host, username, and password.");

  const authHeader =
    "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  const cache = new Map();
  const isFresh = (ts) => Date.now() - ts < cacheTTL * 1000;

  // ------------------------------------------------------------
  // 🌐 Fetch helpers
  // ------------------------------------------------------------
  async function fetchText(endpoint) {
    const url = `http://${host}${endpoint}`;
    log(`🌐 Fetching Meteobridge data from ${url}`);
    const res = await fetch(url, {
      headers: { Authorization: authHeader },
      timeout: 5000,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${endpoint}`);
    return res.text();
  }

  async function fetchXML(endpoint) {
    const xml = await fetchText(endpoint);
    return xml2js.parseStringPromise(xml, { explicitArray: false });
  }

  // ------------------------------------------------------------
  // 🧭 Normalize Meteobridge XML → OpenWeather-style JSON
  // ------------------------------------------------------------
  function normalize(xml) {
    const root = xml.logger || {};
    const extract = (node) => {
      if (!node) return {};
      if (Array.isArray(node)) return node[0].$ || {};
      return node.$ || {};
    };

    const THB = extract(root.THB);
    const TH = extract(root.TH);
    const WIND = extract(root.WIND);
    const RAIN = extract(root.RAIN);
    const UV = extract(root.UV);
    const SOL = extract(root.SOL);

    const n = (v) => (v === undefined ? null : Number(v));

    // Prefer outdoor TH over THB if present
    const tempC = n(TH.temp) ?? n(THB.temp);
    const hum = n(TH.hum) ?? n(THB.hum);
    const press = n(THB.seapress) ?? n(THB.press);
    const dew = n(TH.dew) ?? n(THB.dew);

    const windSpeed = n(WIND.wind);
    const windGust = n(WIND.gust);
    const windDir = n(WIND.dir);
    const rainRate = n(RAIN.rate);
    const rainTotal = n(RAIN.total);
    const solarRad = n(SOL.rad);
    const uvIndex = n(UV.index);

    return {
      coord: { lat: null, lon: null },
      weather: [
        {
          id: 0,
          main: "Weather",
          description: solarRad > 100 ? "Clear" : "Cloudy",
        },
      ],
      main: {
        temp: cToF(tempC),
        feels_like: cToF(tempC),
        pressure: press, // hPa / mbar
        pressure_inHg: hPaToInHg(press), // added imperial
        humidity: hum,
        dew_point: cToF(dew),
      },
      wind: {
        speed: msToMph(windSpeed),
        deg: windDir,
        gust: msToMph(windGust),
      },
      rain: {
        "1h": rainRate || 0,
        total: rainTotal || 0,
      },
      clouds: { all: null },
      visibility: null,
      uv: uvIndex,
      solar_radiation: solarRad,
    };
  }

  // ------------------------------------------------------------
  // GET /api/meteobridge/current  → Cached normalized
  // ------------------------------------------------------------
  router.get("/current", async (req, res) => {
    const key = "current";
    const cached = cache.get(key);
    try {
      if (cached && isFresh(cached.timestamp)) {
        const ageSec = Math.round((Date.now() - cached.timestamp) / 1000);
        log(`💾 Serving cached /current (age=${ageSec}s)`);
        return res.json({ ...cached.data, cache_age_seconds: ageSec });
      }

      const xml = await fetchXML("/cgi-bin/livedataxml.cgi");
      const current = normalize(xml);
      const payload = {
        ...current,
        timestamp: new Date().toISOString(),
        source: host,
        cached: true,
        cache_age_seconds: 0,
      };

      cache.set(key, { data: payload, timestamp: Date.now() });
      res.json(payload);
    } catch (err) {
      log(`❌ Meteobridge /current error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ------------------------------------------------------------
  // GET /api/meteobridge/current_rt  → Real-time normalized (no cache)
  // ------------------------------------------------------------
  router.get("/current_rt", async (req, res) => {
    try {
      log("⚡ Real-time request: /current_rt");
      const xml = await fetchXML("/cgi-bin/livedataxml.cgi");
      const current = normalize(xml);
      const payload = {
        ...current,
        timestamp: new Date().toISOString(),
        source: host,
        cached: false,
        realtime: true,
        cache_age_seconds: 0,
      };
      res.json(payload);
    } catch (err) {
      log(`❌ Meteobridge /current_rt error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ------------------------------------------------------------
  // GET /api/meteobridge/raw  → Parsed JSON (uncached)
  // ------------------------------------------------------------
  router.get("/raw", async (req, res) => {
    try {
      log("🔍 Fetching raw Meteobridge JSON (uncached)");
      const xml = await fetchXML("/cgi-bin/livedataxml.cgi");
      const payload = {
        timestamp: new Date().toISOString(),
        source: host,
        raw: xml,
      };
      res.json(payload);
    } catch (err) {
      log(`❌ Meteobridge /raw error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ------------------------------------------------------------
  // GET /api/meteobridge/xml  → Raw XML text (uncached)
  // ------------------------------------------------------------
  router.get("/xml", async (req, res) => {
    try {
      log("🧾 Fetching raw Meteobridge XML (uncached)");
      const xmlText = await fetchText("/cgi-bin/livedataxml.cgi");
      res.type("application/xml").send(xmlText);
    } catch (err) {
      log(`❌ Meteobridge /xml error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ------------------------------------------------------------
  // GET /api/meteobridge/recent  → Cached historical
  // ------------------------------------------------------------
  router.get("/recent", async (req, res) => {
    const interval = req.query.interval || 3600;
    const limit = req.query.limit || 20;
    const key = `recent_${interval}_${limit}`;
    const cached = cache.get(key);

    try {
      if (cached && isFresh(cached.timestamp)) {
        log(`💾 Serving cached /recent (${interval}, ${limit})`);
        return res.json(cached.data);
      }

      const xml = await fetchXML(
        `/cgi-bin/historyapi.cgi?mode=data&interval=${interval}&limit=${limit}`
      );
      const payload = {
        timestamp: new Date().toISOString(),
        source: host,
        interval,
        limit,
        recent: xml,
      };

      cache.set(key, { data: payload, timestamp: Date.now() });
      res.json(payload);
    } catch (err) {
      log(`❌ Meteobridge /recent error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
