// ------------------------------------------------------------
// 🔊 Sonos Router (API v1)
// Fully restored + modernized version of sonosplayer.js
// - Uses RUNTIME_DIR cache
// - Restores Spotify oEmbed fallback
// - Restores TuneIn + AAC album art extraction
// - Restores full DIDL metadata parsing
// - Preserves transport endpoints + volume control
// ------------------------------------------------------------

import { Router } from "express";
import { SonosManager } from "@svrooij/sonos";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import xml2js from "xml2js";
import { RUNTIME_DIR } from "../../../shared/paths.js";

// ------------------------------------------------------------
// Artwork cache directory: <runtime>/cache/artwork
// ------------------------------------------------------------
const ARTWORK_CACHE_DIR = path.join(RUNTIME_DIR, "cache", "artwork");
fs.mkdirSync(ARTWORK_CACHE_DIR, { recursive: true });

// ------------------------------------------------------------
// Helper: cacheArtwork()
// Writes artwork URL → local jpg and returns public path
// ------------------------------------------------------------
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
    const out = path.join(ARTWORK_CACHE_DIR, `${hash}.jpg`);

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

    // Public URL under /runtime
    return `/runtime/cache/artwork/${hash}.jpg`;
  } catch (err) {
    console.error("⚠️ cacheArtwork error:", err.message);
    return null;
  }
}

// ------------------------------------------------------------
// Helper: parseTrackMeta() — DIDL-Lite Metadata Parser
// ------------------------------------------------------------
async function parseTrackMeta(xml, host) {
  if (!xml || typeof xml !== "string") return {};

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
    console.warn("⚠️ parseTrackMeta error:", err.message);
    return {};
  }
}

// ------------------------------------------------------------
// Internal Sonos Manager Cache
// ------------------------------------------------------------
let manager = null;
let lastDiscover = 0;

async function ensureManager(force = false) {
  const now = Date.now();

  if (!force && manager && now - lastDiscover < 60_000) {
    return manager;
  }

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

// ------------------------------------------------------------
// 🔥 buildGroups()
// Fully restored logic from sonosplayer.js
// ------------------------------------------------------------
async function buildGroups() {
  const mgr = await ensureManager();
  const parser = new xml2js.Parser({ explicitArray: false });
  const groups = new Map();

  // ------------------------------------------------------------
  // STEP 1 — Get Zone Group Topology XML
  // ------------------------------------------------------------
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
          </s:Envelope>`
      });

      const text = await res.text();
      const match = text.match(/<ZoneGroupState>(.*?)<\/ZoneGroupState>/);
      if (match) {
        topologyXML = match[1]
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&");

        break; // Successful, stop loop
      }
    } catch {}
  }

  if (!topologyXML) return [];

  // Parse topology
  const data = await parser.parseStringPromise(topologyXML);
  const zoneGroupsRaw =
    data?.ZoneGroupState?.ZoneGroups?.ZoneGroup ||
    data?.ZoneGroups?.ZoneGroup ||
    data?.ZoneGroup ||
    [];

  const zoneGroups = Array.isArray(zoneGroupsRaw) ? zoneGroupsRaw : [zoneGroupsRaw];

  // Convert topology to map of coordId → members
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
        uuid: m.$.UUID
      }))
    );
  }

  // ------------------------------------------------------------
  // STEP 2 — For each group, collect metadata
  // ------------------------------------------------------------
  const results = [];

  for (const [coordId, members] of groups.entries()) {
    const coord = mgr.Devices.find((d) => d.Uuid === coordId);
    if (!coord) continue;

    let track = { title: "", artist: "", album: "", source: "", uri: "", artwork: null };
    let state = "unknown";

    // ------------------------------------------------------------
    // 2A — Get Position Info + state
    // ------------------------------------------------------------
    try {
      const pos = await coord.AVTransportService.GetPositionInfo();
      const info = await coord.AVTransportService.GetTransportInfo();

      state = info.CurrentTransportState?.toLowerCase() || "unknown";
      track.uri = pos.TrackURI || "";

      const meta = await parseTrackMeta(pos.TrackMetaData, coord.Host);
      track = { ...track, ...meta };
    } catch {}

    // ------------------------------------------------------------
    // 2B — GetMediaInfo (Spotify / TuneIn / Queue)
    // ------------------------------------------------------------
    try {
      const media = await coord.AVTransportService.GetMediaInfo();
      const meta = await parseTrackMeta(
        media.CurrentURIMetaData || media.EnqueuedTransportURIMetaData,
        coord.Host
      );
      if (meta.title) track.title = meta.title;
      if (meta.artist) track.artist = meta.artist;
      if (meta.album) track.album = meta.album;
      if (meta.artwork) track.artwork = meta.artwork;
    } catch {}

    // ------------------------------------------------------------
    // 2C — Fallbacks: TuneIn Placeholder
    // ------------------------------------------------------------
    if (!track.artwork && track.uri?.includes("x-rincon-mp3radio")) {
      track.artwork = "/runtime/cache/artwork/tunein-default.jpg";
    }

    // ------------------------------------------------------------
    // 2D — Spotify oEmbed fallback (✔ KEEP)
    // ------------------------------------------------------------
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
            track.title ||= data?.title?.replace(/ - topic$/i, "");
          }
        }
      } catch (e) {
        console.warn("⚠️ Spotify oEmbed failed:", e.message);
      }
    }

    // ------------------------------------------------------------
    // 2E — TuneIn / AAC advanced metadata
    // ------------------------------------------------------------
    if (
      track.uri?.includes("tunein") ||
      track.uri?.includes("mp3radio") ||
      track.uri?.startsWith("aac://")
    ) {
      try {
        const res = await fetch(`http://${coord.Host}:1400/MediaRenderer/AVTransport/Control`, {
          method: "POST",
          headers: {
            "SOAPACTION": '"urn:schemas-upnp-org:service:AVTransport:1#GetMediaInfo"',
            "Content-Type": 'text/xml; charset="utf-8"',
          },
          body: `<?xml version="1.0"?>
            <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
                        s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
              <s:Body>
                <u:GetMediaInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
                  <InstanceID>0</InstanceID>
                </u:GetMediaInfo>
              </s:Body>
            </s:Envelope>`
        });

        const xmlText = await res.text();
        const p2 = new xml2js.Parser({ explicitArray: false });
        const parsed = await p2.parseStringPromise(xmlText);

        let metaContent =
          parsed?.["s:Envelope"]?.["s:Body"]?.["u:GetMediaInfoResponse"]?.CurrentURIMetaData;

        if (typeof metaContent === "object") metaContent = metaContent._ || "";

        if (metaContent?.includes("<DIDL-Lite")) {
          const inner = await p2.parseStringPromise(metaContent);
          const item = inner?.["DIDL-Lite"]?.item || {};

          let artUri =
            item["upnp:albumArtURI"] ||
            inner?.["DIDL-Lite"]?.["upnp:albumArtURI"] ||
            null;

          if (artUri) {
            artUri = artUri.replace(/&amp;/g, "&").trim();
            if (!/^https?:\/\//i.test(artUri))
              artUri = `http://${coord.Host}:1400${artUri}`;

            if (!track.artwork || track.artwork.includes("tunein-default")) {
              track.artwork = artUri;
            }
          } else if (track.uri.startsWith("aac://")) {
            track.artwork = `http://${coord.Host}:1400/getaa?s=1&u=${encodeURIComponent(
              track.uri
            )}`;
          }

          // Fill in title/artist/album
          track.title ||= item["dc:title"];
          track.artist ||= item["dc:creator"] || "Live Stream";
          track.album ||= "TuneIn Radio";
        }
      } catch (err) {
        console.warn("⚠️ Stream metadata error:", err.message);
      }
    }

    // ------------------------------------------------------------
    // 2F — Source normalization
    // ------------------------------------------------------------
    track.source =
      track.uri.includes("spotify")
        ? "Spotify"
        : track.uri.includes("mp3radio")
        ? "MP3 Radio"
        : track.uri.includes("tunein")
        ? "TuneIn"
        : "Sonos Queue";

    // ------------------------------------------------------------
    // 2G — Cache artwork locally
    // ------------------------------------------------------------
    const artFile = await cacheArtwork(track.artwork);
    if (artFile) track.artwork = artFile;

    // ------------------------------------------------------------
    // 2H — Retrieve volumes for each speaker
    // ------------------------------------------------------------
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
      vols.length > 0
        ? Math.round(vols.reduce((a, b) => a + b, 0) / vols.length)
        : 0;

    // ------------------------------------------------------------
    // Assemble group
    // ------------------------------------------------------------
    results.push({
      id: coordId,
      name: `${members[0]?.name}${members.length > 1 ? " +" + (members.length - 1) : ""}`,
      coordinator: coordId,
      status: state,
      track,
      avgVolume,
      members
    });
  }

  return results;
}

// ------------------------------------------------------------
// Router Initialization
// ------------------------------------------------------------
const router = Router();

// Force rediscovery
router.get("/discover", async (_req, res) => {
  try {
    await ensureManager(true);
    res.json({ ok: true, devices: manager.Devices?.length ?? 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Device list
router.get("/devices", async (_req, res) => {
  const mgr = await ensureManager();
  res.json({
    devices: mgr.Devices.map((d) => ({
      name: d.Name,
      host: d.Host,
      uuid: d.Uuid
    }))
  });
});

// Full groups
router.get("/groups", async (_req, res) => {
  try {
    const groups = await buildGroups();
    res.json({ groups, count: groups.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// Transport Endpoints: play, pause, next, previous
// ------------------------------------------------------------
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
        req.body?.groupId ||
        req.query?.groupId ||
        req.body?.id ||
        req.query?.id;

      if (!groupId) throw new Error(`Missing 'groupId' for ${endpoint}`);

      const mgr = await ensureManager();
      const coord = mgr.Devices.find((d) => d.Uuid === groupId);
      if (!coord) throw new Error(`Coordinator not found: ${groupId}`);

      const svc = coord.AVTransportService;

      if (method === "Play") {
        try {
          await svc.Play({ InstanceID: 0, Speed: 1 });
        } catch (err) {
          if (/UPnPError 402/i.test(err.message)) {
            console.warn(`Rebinding and retrying Play on ${groupId}`);

            const coordURI = `x-rincon:${coord.uuid}`;
            for (const d of mgr.Devices) {
              try {
                await d.AVTransportService.SetAVTransportURI({
                  InstanceID: 0,
                  CurrentURI: coordURI,
                  CurrentURIMetaData: "",
                });
              } catch {}
            }

            await svc.Play({ InstanceID: 0, Speed: 1 });
          } else throw err;
        }
      } else {
        await svc[method]({ InstanceID: 0 });
      }

      res.json({ ok: true, action: endpoint, id: groupId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

// ------------------------------------------------------------
// VOLUME ENDPOINT
// ------------------------------------------------------------
router.all("/volume", async (req, res) => {
  try {
    const groupId =
      req.body?.groupId ||
      req.query?.groupId ||
      req.body?.id ||
      req.query?.id;

    const level = req.body?.level ?? req.query?.level;

    const mgr = await ensureManager();

    // Must refresh topology so we know which speakers are in the group
    const groups = await buildGroups();
    const group = groups.find((g) => g.id === groupId);
    if (!group) throw new Error(`Group not found: ${groupId}`);

    if (level !== undefined) {
      const v = Number(level);
      if (isNaN(v) || v < 0 || v > 100)
        throw new Error("Volume must be 0–100");

      for (const m of group.members) {
        try {
          const dev = mgr.Devices.find((d) => d.Host === m.host);
          await dev?.RenderingControlService?.SetVolume({
            InstanceID: 0,
            Channel: "Master",
            DesiredVolume: v,
          });
        } catch {}
      }

      res.json({ ok: true, id: groupId, volume: v });
    } else {
      // Read group average
      const vols = [];
      for (const m of group.members) {
        try {
          const dev = mgr.Devices.find((d) => d.Host === m.host);
          const v = await dev?.RenderingControlService?.GetVolume({
            InstanceID: 0,
            Channel: "Master",
          });
          vols.push(Number(v.CurrentVolume));
        } catch {}
      }

      const avg =
        vols.length > 0
          ? Math.round(vols.reduce((a, b) => a + b, 0) / vols.length)
          : 0;

      res.json({ id: groupId, volume: avg });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
