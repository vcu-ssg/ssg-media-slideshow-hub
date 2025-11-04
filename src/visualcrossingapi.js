// ------------------------------------------------------------
// 🌦️ Visual Crossing Weather API module – Node 22 (native fetch)
// ------------------------------------------------------------
export function createVisualCrossingRouter(express, VC_KEY, log) {
  const router = express.Router();

  // --- Simple caches ---
  const cache = new Map();
  const TTL = {
    CURRENT: 10 * 60 * 1000,
    HOURLY: 30 * 60 * 1000,
    DAILY: 30 * 60 * 1000,
    GEO: 24 * 60 * 60 * 1000,
  };

  
// ------------------------------------------------------------
// 🗺️ Resolve coordinates via ZIP or city name
// ------------------------------------------------------------
async function resolveCoords({ lat, lon, zip, city }) {
  // Direct lat/lon provided
  if (lat && lon) return { lat: parseFloat(lat), lon: parseFloat(lon) };

  // --- ZIP lookup (US only) ---
  if (zip) {
    const cached = cache.get(`zip:${zip}`);
    if (cached && Date.now() - cached.ts < TTL.GEO) return cached.data;

    const r = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!r.ok) throw new Error(`ZIP lookup failed (${r.status})`);
    const z = await r.json();
    const p = z.places?.[0];
    if (!p) throw new Error(`No place for ZIP ${zip}`);

    const data = {
      lat: parseFloat(p.latitude),
      lon: parseFloat(p.longitude),
      name: p["place name"],
      state_abbr: p["state abbreviation"],
      state_name: p.state,
      country: z.country_abbreviation,
    };
    cache.set(`zip:${zip}`, { data, ts: Date.now() });
    return data;
  }

  // --- City/state name: let Visual Crossing interpret it directly ---
  if (city) {
    // Visual Crossing can handle "Auburn,AL" or "Richmond,VA" natively
    return { city };
  }

  throw new Error("No location parameters provided");
}

  // ------------------------------------------------------------
  // 🔗 Helper to build the Visual Crossing URL
  // ------------------------------------------------------------
  function vcUrl({ lat, lon, city, zip, units, mode }) {
    const loc = zip
      ? zip
      : city
      ? encodeURIComponent(city)
      : `${lat},${lon}`;
    const base = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${loc}`;
    const params = new URLSearchParams({
      unitGroup: units === "metric" ? "metric" : "us",
      include: "current,days,hours",
      contentType: "json",
      key: VC_KEY,
    });
    return `${base}?${params.toString()}`;
  }

  // ------------------------------------------------------------
  // 🌡️ /api/visualcrossing/current
  // ------------------------------------------------------------
  router.get("/current", async (req, res) => {
    const { lat, lon, zip, city, units } = req.query;
    try {
      const coords = await resolveCoords({ lat, lon, zip, city });
      const key = `current:${coords.lat},${coords.lon},${units}`;
      const cached = cache.get(key);
      if (cached && Date.now() - cached.ts < TTL.CURRENT)
        return res.json(cached.data);

      const r = await fetch(vcUrl({ ...coords, zip, city, units }));
      const data = await r.json();
      if (!r.ok) throw new Error(`VC current error ${r.status}`);

      const payload = {
        ...data.currentConditions,
        city: {
          name: coords.name,
          state_abbr: coords.state_abbr,
          state_name: coords.state_name,
          country: coords.country,
        },
        resolvedAddress: data.resolvedAddress,
      };

      cache.set(key, { data: payload, ts: Date.now() });
      res.json(payload);
    } catch (err) {
      console.error("❌ VC current error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ------------------------------------------------------------
  // 🕒 /api/visualcrossing/hourly
  // ------------------------------------------------------------
  router.get("/hourly", async (req, res) => {
    const { lat, lon, zip, city, units } = req.query;
    try {
      const coords = await resolveCoords({ lat, lon, zip, city });
      const key = `hourly:${coords.lat},${coords.lon},${units}`;
      const cached = cache.get(key);
      if (cached && Date.now() - cached.ts < TTL.HOURLY)
        return res.json(cached.data);

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
          conditions: h.conditions,
        }))
      );

      const payload = {
        city: {
          name: coords.name,
          state_abbr: coords.state_abbr,
          state_name: coords.state_name,
          country: coords.country,
        },
        resolvedAddress: data.resolvedAddress,
        hours,
      };

      cache.set(key, { data: payload, ts: Date.now() });
      res.json(payload);
    } catch (err) {
      console.error("❌ VC hourly error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ------------------------------------------------------------
  // 🌤️ /api/visualcrossing/daily
  // ------------------------------------------------------------
  router.get("/daily", async (req, res) => {
    const { lat, lon, zip, city, units } = req.query;
    try {
      const coords = await resolveCoords({ lat, lon, zip, city });
      const key = `daily:${coords.lat},${coords.lon},${units}`;
      const cached = cache.get(key);
      if (cached && Date.now() - cached.ts < TTL.DAILY)
        return res.json(cached.data);

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
        conditions: d.conditions,
      }));

      const payload = {
        city: {
          name: coords.name,
          state_abbr: coords.state_abbr,
          state_name: coords.state_name,
          country: coords.country,
        },
        resolvedAddress: data.resolvedAddress,
        days,
      };

      cache.set(key, { data: payload, ts: Date.now() });
      res.json(payload);
    } catch (err) {
      console.error("❌ VC daily error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
