// ------------------------------------------------------------
// 🌦️ Meteobridge Router (API v1)
// ------------------------------------------------------------
// Normalized weather, raw JSON, raw XML, cached recent history
// ------------------------------------------------------------

import { Router } from "express";
import xml2js from "xml2js";

// Optional shared logger (fallback to console)
import { log } from "../../../shared/log.js";

// Unit conversions
function cToF(c) { return (c === null || isNaN(c)) ? null : (c * 9) / 5 + 32; }
function msToMph(ms) { return (ms === null || isNaN(ms)) ? null : ms * 2.23694; }
function hPaToInHg(hPa) { return (hPa === null || isNaN(hPa)) ? null : hPa * 0.02953; }

// ------------------------------------------------------------
// Factory: create a configured router instance
// ------------------------------------------------------------
export default function createMeteobridgeRouter({
  host,
  username,
  password,
  cacheTTL = 30,
} = {}) {
  if (!host || !username || !password) {
    throw new Error("Meteobridge router requires { host, username, password }");
  }

  const router = Router();
  const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  const cache = new Map();
  const isFresh = (ts) => Date.now() - ts < cacheTTL * 1000;

  // ------------------------------------------------------------
  // HTTP helpers
  // ------------------------------------------------------------
  async function fetchText(endpoint) {
    const url = `http://${host}${endpoint}`;
    log(`🌐 Meteobridge → ${url}`);

    const res = await fetch(url, {
      headers: { Authorization: authHeader },
      method: "GET",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.text();
  }

  async function fetchXML(endpoint) {
    const xml = await fetchText(endpoint);
    return xml2js.parseStringPromise(xml, { explicitArray: false });
  }

  // ------------------------------------------------------------
  // Normalize Meteobridge XML → OpenWeather-like structure
  // ------------------------------------------------------------
  function normalize(xml) {
    const root = xml?.logger || {};
    const asNode = (n) => Array.isArray(n) ? n[0]?.$ || {} : n?.$ || {};

    const THB = asNode(root.THB);
    const TH = asNode(root.TH);
    const WIND = asNode(root.WIND);
    const RAIN = asNode(root.RAIN);
    const UV = asNode(root.UV);
    const SOL = asNode(root.SOL);

    const n = (v) => (v === undefined ? null : Number(v));

    // Prefer outdoor TH over THB
    const tempC = n(TH.temp) ?? n(THB.temp);
    const hum = n(TH.hum) ?? n(THB.hum);
    const press = n(THB.seapress) ?? n(THB.press);
    const dew = n(TH.dew) ?? n(THB.dew);

    return {
      coord: { lat: null, lon: null },
      weather: [{ id: 0, main: "Weather", description: SOL.rad > 100 ? "Clear" : "Cloudy" }],
      main: {
        temp: cToF(tempC),
        feels_like: cToF(tempC),
        pressure: press,
        pressure_inHg: hPaToInHg(press),
        humidity: hum,
        dew_point: cToF(dew),
      },
      wind: {
        speed: msToMph(n(WIND.wind)),
        deg: n(WIND.dir),
        gust: msToMph(n(WIND.gust)),
      },
      rain: {
        "1h": n(RAIN.rate) || 0,
        total: n(RAIN.total) || 0,
      },
      uv: n(UV.index),
      solar_radiation: n(SOL.rad),
    };
  }

  // ------------------------------------------------------------
  // Routes (mounted under /api/v1/meteobridge)
  // ------------------------------------------------------------

  // GET /api/v1/meteobridge/current
  router.get("/current", async (_req, res) => {
    const key = "current";
    const cached = cache.get(key);

    try {
      if (cached && isFresh(cached.ts)) {
        return res.json({ ...cached.data, cache_age_seconds: Math.round((Date.now() - cached.ts) / 1000) });
      }

      const xml = await fetchXML("/cgi-bin/livedataxml.cgi");
      const data = normalize(xml);

      const payload = {
        ...data,
        timestamp: new Date().toISOString(),
        source: host,
        cached: true,
      };

      cache.set(key, { ts: Date.now(), data: payload });
      res.json(payload);
    } catch (err) {
      log(`❌ Meteobridge current error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/meteobridge/current_rt
  router.get("/current_rt", async (_req, res) => {
    try {
      const xml = await fetchXML("/cgi-bin/livedataxml.cgi");
      const data = normalize(xml);
      res.json({
        ...data,
        timestamp: new Date().toISOString(),
        cached: false,
        realtime: true,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/meteobridge/raw
  router.get("/raw", async (_req, res) => {
    try {
      const xml = await fetchXML("/cgi-bin/livedataxml.cgi");
      res.json({ timestamp: new Date().toISOString(), raw: xml });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/meteobridge/xml
  router.get("/xml", async (_req, res) => {
    try {
      const txt = await fetchText("/cgi-bin/livedataxml.cgi");
      res.type("application/xml").send(txt);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/v1/meteobridge/recent
  router.get("/recent", async (req, res) => {
    const interval = req.query.interval || 3600;
    const limit = req.query.limit || 20;
    const key = `recent_${interval}_${limit}`;
    const cached = cache.get(key);

    try {
      if (cached && isFresh(cached.ts)) {
        return res.json(cached.data);
      }

      const xml = await fetchXML(`/cgi-bin/historyapi.cgi?mode=data&interval=${interval}&limit=${limit}`);

      const payload = {
        timestamp: new Date().toISOString(),
        interval,
        limit,
        source: host,
        recent: xml,
      };

      cache.set(key, { ts: Date.now(), data: payload });
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
