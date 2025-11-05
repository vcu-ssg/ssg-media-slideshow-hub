/**
 * sonosplayer.js — Express router for @svrooij/sonos v2.17+
 * ✅ Uses groupId (Coordinator UUID) for actions
 * ✅ Retains working Spotify artwork
 * ✅ Restores TuneIn / r:albumArtURI artwork via XML parsing
 * ✅ Adds next/previous transport endpoints
 */

import express from "express";
import { SonosManager } from "@svrooij/sonos";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import xml2js from "xml2js";
import { fileURLToPath } from "url";

// ───────────────────────────────
// Unified paths
// ───────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, "..");
const CACHE_DIR = path.join(ROOT_DIR, "cache", "artwork");
fs.mkdirSync(CACHE_DIR, { recursive: true });

// ───────────────────────────────
// Helper: cacheArtwork()
// ───────────────────────────────
async function cacheArtwork(uri) {
  if (!uri || !uri.startsWith("http")) return null;
  try {
    const cleanUri = decodeURIComponent(
      uri
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
    );
    const hash = crypto.createHash("md5").update(cleanUri).digest("hex");
    const out = path.join(CACHE_DIR, `${hash}.jpg`);
    if (!fs.existsSync(out)) {
      const res = await fetch(cleanUri);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(out, buf);
        console.log(`🖼️ Cached artwork → ${out}`);
      } else {
        console.warn(`⚠️ Artwork fetch failed: ${cleanUri} (${res.status})`);
      }
    }
    return `/cache/artwork/${hash}.jpg`;
  } catch (err) {
    console.error("⚠️ cacheArtwork error:", err.message);
    return null;
  }
}

// ───────────────────────────────
// Helper: extractTrackMetadata()
// ───────────────────────────────

async function extractTrackMetadata(xml, host) {
  if (!xml || typeof xml !== "string") return {};

  // Unescape Sonos-escaped DIDL XML
  const decoded = xml
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

  if (!decoded.includes("<DIDL-Lite")) return {};

  try {
    const parser = new xml2js.Parser({ explicitArray: false });
    const data = await parser.parseStringPromise(decoded);
    const item = data["DIDL-Lite"]?.item || {};

    const title =
      item["r:streamContent"] ||
      item["dc:title"] ||
      "";
    const artist = item["dc:creator"] || "";
    const album = item["upnp:album"] || "";
    let artwork =
      item["upnp:albumArtURI"] ||
      item["r:albumArtURI"] ||
      item["albumArtURI"];

    if (artwork && !artwork.startsWith("http")) {
      artwork = `http://${host}:1400${artwork}`;
    }

    return { title, artist, album, artwork };
  } catch (err) {
    console.warn("⚠️ extractTrackMetadata parse error:", err.message);
    return {};
  }
}

// ───────────────────────────────
// Router factory
// ───────────────────────────────
export function createSonosRouter() {
  const router = express.Router();
  router.use(express.json());
  router.use(express.urlencoded({ extended: true }));

  let manager;
  let lastDiscover = 0;

  // ───────────────────────────────
  // Discovery
  // ───────────────────────────────
  async function ensureManager(force = false) {
    const now = Date.now();
    if (!force && manager && now - lastDiscover < 60000) return manager;

    console.log("🔍 Discovering Sonos devices...");
    manager = new SonosManager();
    const discovered = await manager.InitializeWithDiscovery(5000);
    if (Array.isArray(discovered)) {
      for (const dev of discovered) {
        try {
          await manager.TryAddDevice(dev.Host);
        } catch {}
      }
    }
    manager.Devices ||= [];
    lastDiscover = now;
    console.log(`✅ ${manager.Devices.length} devices registered`);
    return manager;
  }

// ───────────────────────────────
// Build groups (TuneIn + Spotify metadata fix)
// ───────────────────────────────
async function buildGroups() {
  const mgr = await ensureManager();
  const parser = new xml2js.Parser({ explicitArray: false });
  const groups = new Map();

  // ── Discover topology ──
  let topologyXML = "";
  for (const dev of mgr.Devices) {
    try {
      const res = await fetch(`http://${dev.Host}:1400/ZoneGroupTopology/Control`, {
        method: "POST",
        headers: {
          "SOAPACTION": '"urn:schemas-upnp-org:service:ZoneGroupTopology:1#GetZoneGroupState"',
          "Content-Type": 'text/xml; charset="utf-8"',
        },
        body: `<?xml version="1.0"?>
          <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
            <s:Body>
              <u:GetZoneGroupState xmlns:u="urn:schemas-upnp-org:service:ZoneGroupTopology:1"/>
            </s:Body>
          </s:Envelope>`,
      });
      const text = await res.text();
      const match = text.match(/<ZoneGroupState>(.*?)<\/ZoneGroupState>/);
      if (match) {
        topologyXML = match[1]
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&");
        break;
      }
    } catch {}
  }
  if (!topologyXML) return [];

  const data = await parser.parseStringPromise(topologyXML);
  const zoneGroupsRaw =
    data?.ZoneGroupState?.ZoneGroups?.ZoneGroup ||
    data?.ZoneGroups?.ZoneGroup ||
    data?.ZoneGroup ||
    [];
  const zoneGroups = Array.isArray(zoneGroupsRaw) ? zoneGroupsRaw : [zoneGroupsRaw];

  for (const g of zoneGroups) {
    const coordId = g.$?.Coordinator;
    const members = Array.isArray(g.ZoneGroupMember)
      ? g.ZoneGroupMember
      : [g.ZoneGroupMember];
    groups.set(
      coordId,
      members.map((m) => ({
        name: m.$.ZoneName,
        host: new URL(m.$.Location).hostname,
        uuid: m.$.UUID,
      }))
    );
  }

  const results = [];
  for (const [coordId, members] of groups.entries()) {
    const coord = mgr.Devices.find((d) => d.Uuid === coordId);
    if (!coord) continue;

    let track = { title: "", artist: "", album: "", source: "", uri: "", artwork: null };
    let state = "unknown";

    // ── Get current playback info ──
    try {
      const pos = await coord.AVTransportService.GetPositionInfo();
      const info = await coord.AVTransportService.GetTransportInfo();
      state = info.CurrentTransportState?.toLowerCase() || "unknown";
      track.uri = pos.TrackURI || "";

      // Try to extract title/artist/album from position info
      const meta = parseTrackMeta(pos.TrackMetaData, coord.Host);
      track = { ...track, ...meta };
    } catch {}

    // ── Spotify and other sources from GetMediaInfo ──
    try {
      const media = await coord.AVTransportService.GetMediaInfo();
      const meta = parseTrackMeta(
        media.CurrentURIMetaData || media.EnqueuedTransportURIMetaData,
        coord.Host
      );

      // This must override empty values from position info
      if (meta.title) track.title = meta.title;
      if (meta.artist) track.artist = meta.artist;
      if (meta.album) track.album = meta.album;
      if (meta.artwork) track.artwork = meta.artwork;
    } catch {}

    // ── TuneIn + Spotify Fallbacks ──

    // 1️⃣ TuneIn placeholder
    if (!track.artwork && track.uri?.includes("x-rincon-mp3radio")) {
      track.artwork = "/cache/artwork/tunein-default.jpg";
    }

    // 2️⃣ Spotify artwork fix
    if (!track.artwork && track.uri?.includes("spotify:track:")) {
      try {
        const id = track.uri.match(/spotify:track:([A-Za-z0-9]+)/)?.[1];
        if (id) {
          const oembed = await fetch(
            `https://open.spotify.com/oembed?url=spotify:track:${id}`
          );
          if (oembed.ok) {
            const data = await oembed.json();
            track.artwork = data?.thumbnail_url || track.artwork;
            track.title ||= data?.title?.replace(/ - topic$/i, "") || track.title;
          }
        }
      } catch (e) {
        console.warn("⚠️ Spotify artwork lookup failed:", e.message);
      }
    }

    // 3️⃣ TuneIn: artwork + metadata from GetMediaInfo
    if (track.uri?.includes("tunein") || track.uri?.includes("mp3radio")) {
      try {
        const res = await fetch(`http://${coord.Host}:1400/MediaRenderer/AVTransport/Control`, {
          method: "POST",
          headers: {
            "SOAPACTION": '"urn:schemas-upnp-org:service:AVTransport:1#GetMediaInfo"',
            "Content-Type": 'text/xml; charset="utf-8"',
          },
          body: `<?xml version="1.0" encoding="utf-8"?>
            <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
                        s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
              <s:Body>
                <u:GetMediaInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
                  <InstanceID>0</InstanceID>
                </u:GetMediaInfo>
              </s:Body>
            </s:Envelope>`,
        });

        const xmlText = await res.text();
        const p2 = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
        const parsed = await p2.parseStringPromise(xmlText);

        let metaContent =
          parsed?.["s:Envelope"]?.["s:Body"]?.["u:GetMediaInfoResponse"]?.CurrentURIMetaData;
        if (typeof metaContent === "object") metaContent = metaContent._ || "";

        if (metaContent && metaContent.includes("<DIDL-Lite")) {
          const inner = await p2.parseStringPromise(metaContent);
          const item = inner?.["DIDL-Lite"]?.item || {};

          const artUri =
            item["upnp:albumArtURI"] || inner?.["DIDL-Lite"]?.["upnp:albumArtURI"];
          if (artUri && (!track.artwork || track.artwork.includes("tunein-default"))) {
            const clean = artUri.replace(/&amp;/g, "&").trim();
            track.artwork = clean;
          }

          // Add title/artist/album if missing
          track.title ||= item["dc:title"] || track.title;
          track.artist ||= item["dc:creator"] || "Live Stream";
          track.album ||= track.album || "TuneIn Radio";
        }
      } catch (e) {
        console.warn(`⚠️ TuneIn metadata extraction failed: ${e.message}`);
      }
    }

    // ── Final normalize ──
    track.source = track.uri.includes("spotify")
      ? "Spotify"
      : track.uri.includes("mp3radio")
      ? "MP3 Radio"
      : track.uri.includes("tunein")
      ? "TuneIn"
      : "Sonos Queue";

    const artFile = await cacheArtwork(track.artwork);
    if (artFile) track.artwork = artFile;

    // ── Volumes ──
    const vols = [];
    for (const m of members) {
      try {
        const dev = mgr.Devices.find((d) => d.Host === m.host);
        if (!dev) continue;
        const v = await dev.RenderingControlService.GetVolume({
          InstanceID: 0,
          Channel: "Master",
        });
        m.volume = Number(v.CurrentVolume);
        vols.push(m.volume);
      } catch {
        m.volume = null;
      }
    }

    const avgVolume =
      vols.length > 0 ? Math.round(vols.reduce((a, b) => a + b, 0) / vols.length) : 0;

    results.push({
      id: coordId,
      name: `${members[0]?.name}${members.length > 1 ? " +" + (members.length - 1) : ""}`,
      coordinator: coordId,
      status: state,
      track,
      avgVolume,
      members,
    });
  }

  return results;
}


  // ───────────────────────────────
  // Routes
  // ───────────────────────────────
  router.get("/discover", async (_req, res) => {
    try {
      await ensureManager(true);
      res.json({ ok: true, devices: manager.Devices?.length ?? 0 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/devices", async (_req, res) => {
    const mgr = await ensureManager();
    res.json({
      devices: mgr.Devices.map((d) => ({
        name: d.Name,
        host: d.Host,
        uuid: d.Uuid,
      })),
    });
  });

  router.get("/groups", async (_req, res) => {
    try {
      const groups = await buildGroups();
      res.json({ groups, count: groups.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Unified transport actions
  const actions = {
    play: "Play",
    pause: "Pause",
    next: "Next",
    previous: "Previous",
  };

  for (const [endpoint, method] of Object.entries(actions)) {
    router.all(`/${endpoint}`, async (req, res) => {
      try {
        const groupId =
          req.body?.groupId || req.query?.groupId || req.body?.id || req.query?.id;
        if (!groupId) throw new Error(`Missing 'groupId' for ${endpoint}`);

        const mgr = await ensureManager();
        const coord = mgr.Devices.find((d) => d.Uuid === groupId);
        if (!coord) throw new Error(`Coordinator not found for id=${groupId}`);
        const svc = coord.AVTransportService;
        if (!svc) throw new Error("AVTransportService unavailable");

        if (method === "Play") {
          try {
            await svc.Play({ InstanceID: 0, Speed: 1 });
          } catch (err) {
            if (/UPnPError 402/i.test(err.message)) {
              console.warn(`🎬 Rebinding and retrying Play on ${groupId}`);
              const coordURI = `x-rincon:${coord.uuid}`;
              for (const d of mgr.Devices) {
                try {
                  const svc2 = d.AVTransportService;
                  await svc2.SetAVTransportURI({
                    InstanceID: 0,
                    CurrentURI: coordURI,
                    CurrentURIMetaData: "",
                  });
                } catch {}
              }
              await svc.Play({ InstanceID: 0, Speed: 1 });
            } else {
              throw err;
            }
          }
        } else {
          await svc[method]({ InstanceID: 0 });
        }

        console.log(`▶️ ${method} executed for group ${groupId}`);
        res.json({ ok: true, action: endpoint, id: groupId });
      } catch (err) {
        console.error(`❌ ${endpoint.toUpperCase()} failed:`, err.message);
        res.status(500).json({ error: err.message });
      }
    });
  }


  // ───────────────────────────────
// Volume endpoint (fixed for Sonos groups)
// ───────────────────────────────
router.all("/volume", async (req, res) => {
  try {
    const groupId =
      req.body?.groupId || req.query?.groupId || req.body?.id || req.query?.id;
    const level = req.body?.level ?? req.query?.level;

    const mgr = await ensureManager();
    const coord = mgr.Devices.find((d) => d.Uuid === groupId);
    if (!coord) throw new Error(`Group not found for id=${groupId}`);

    // Find the members of this group from the topology
    const groups = await buildGroups();
    const group = groups.find((g) => g.id === groupId);
    if (!group) throw new Error(`Group not found in topology for id=${groupId}`);

    if (level !== undefined) {
      // ─── Set group volume (per member) ───
      const v = Number(level);
      if (isNaN(v) || v < 0 || v > 100) throw new Error("Volume must be 0–100");

      for (const m of group.members) {
        try {
          const dev = mgr.Devices.find((d) => d.Host === m.host);
          if (dev?.RenderingControlService) {
            await dev.RenderingControlService.SetVolume({
              InstanceID: 0,
              Channel: "Master",
              DesiredVolume: v,
            });
          }
        } catch (e) {
          console.warn(`⚠️ Failed to set volume for ${m.name}: ${e.message}`);
        }
      }

      res.json({ ok: true, id: groupId, volume: v });
    } else {
      // ─── Get average group volume ───
      const vols = [];
      for (const m of group.members) {
        try {
          const dev = mgr.Devices.find((d) => d.Host === m.host);
          if (dev?.RenderingControlService) {
            const v = await dev.RenderingControlService.GetVolume({
              InstanceID: 0,
              Channel: "Master",
            });
            vols.push(Number(v.CurrentVolume));
          }
        } catch {}
      }

      const avg =
        vols.length > 0 ? Math.round(vols.reduce((a, b) => a + b, 0) / vols.length) : 0;
      res.json({ id: groupId, volume: avg });
    }
  } catch (err) {
    console.error("❌ Volume endpoint error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


  return router;
}
