/**
 * sonosplayer.js — Express 5 router for @svrooij/sonos v2.17+
 * Drop-in replacement with improved TrackMeta parsing and robust metadata handling.
 */
import express from "express";
import { SonosManager } from "@svrooij/sonos";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import xml2js from "xml2js";

export function createSonosRouter() {
  const router = express.Router();
  let manager;
  let lastDiscover = 0;

  const CACHE_DIR = path.join(process.cwd(), "cache", "artwork");
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  // ───────────────────────────────
  // Helpers
  // ───────────────────────────────
  async function cacheArtwork(uri) {
    if (!uri || !uri.startsWith("http")) return null;
    try {
      const hash = crypto.createHash("md5").update(uri).digest("hex");
      const out = path.join(CACHE_DIR, `${hash}.jpg`);
      if (!fs.existsSync(out)) {
        const res = await fetch(uri);
        if (res.ok) fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
      }
      return `/cache/artwork/${hash}.jpg`;
    } catch {
      return null;
    }
  }

function parseTrackMeta(rawXml, host) {
  if (!rawXml || typeof rawXml !== "string") return {};

  // Decode Sonos-escaped DIDL strings
  const decoded = rawXml
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

  // Pull metadata tags safely
  const titleMatch = decoded.match(/<dc:title>([^<]*)<\/dc:title>/i);
  const artistMatch = decoded.match(/<dc:creator>([^<]*)<\/dc:creator>/i);
  const albumMatch = decoded.match(/<upnp:album>([^<]*)<\/upnp:album>/i);
  const artMatch = decoded.match(/<upnp:albumArtURI>([^<]*)<\/upnp:albumArtURI>/i);

  const title = titleMatch ? titleMatch[1].trim() : "";
  const artist = artistMatch ? artistMatch[1].trim() : "";
  const album = albumMatch ? albumMatch[1].trim() : "";
  const artRel = artMatch ? artMatch[1].trim() : null;
  const artwork =
    artRel && !artRel.startsWith("http")
      ? `http://${host}:1400${artRel}`
      : artRel || null;

  return { title, artist, album, artwork };
}


  // ───────────────────────────────
  // Discovery
  // ───────────────────────────────
  async function ensureManager(force = false) {
    const now = Date.now();
    if (!force && manager && now - lastDiscover < 60000) return manager;

    console.log("🔍 Discovering Sonos devices (direct)...");
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
// buildGroups() — drop-in replacement
// ───────────────────────────────
async function buildGroups() {
  const mgr = await ensureManager();
  const parser = new xml2js.Parser({ explicitArray: false });
  const groups = new Map();

  // ──────────── Discover topology ────────────
  let topologyXML = "";
  for (const dev of mgr.Devices) {
    try {
      const res = await fetch(`http://${dev.Host}:1400/ZoneGroupTopology/Control`, {
        method: "POST",
        headers: {
          "SOAPACTION":
            '"urn:schemas-upnp-org:service:ZoneGroupTopology:1#GetZoneGroupState"',
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
  const zoneGroups = Array.isArray(zoneGroupsRaw)
    ? zoneGroupsRaw
    : [zoneGroupsRaw];

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

  // ──────────── Process each group ────────────
  for (const [coordId, members] of groups.entries()) {
    const coord = mgr.Devices.find((d) => d.Uuid === coordId);
    if (!coord) continue;

    let track = {
      title: "",
      artist: "",
      album: "",
      source: "",
      uri: "",
      artwork: null,
    };
    let state = "unknown";

    try {
      // ── Try coordinator first
      const pos = await coord.AVTransportService.GetPositionInfo();
      const info = await coord.AVTransportService.GetTransportInfo();
      state = info.CurrentTransportState?.toLowerCase() || "unknown";
      track.uri = pos.TrackURI || "";

      let meta = parseTrackMeta(pos.TrackMetaData, coord.Host);

      // ── If coordinator lacks metadata, query members directly
      if (!meta.title) {
        for (const m of members) {
          try {
            const res = await fetch(`http://${m.host}:1400/MediaRenderer/AVTransport/Control`, {
              method: "POST",
              headers: {
                "Content-Type": 'text/xml; charset="utf-8"',
                SOAPACTION:
                  '"urn:schemas-upnp-org:service:AVTransport:1#GetPositionInfo"',
              },
              body: `<?xml version="1.0" encoding="utf-8"?>
                <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
                            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
                  <s:Body>
                    <u:GetPositionInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
                      <InstanceID>0</InstanceID>
                    </u:GetPositionInfo>
                  </s:Body>
                </s:Envelope>`,
            });
            const xmlText = await res.text();
            const match = xmlText.match(/<TrackMetaData>(.*?)<\/TrackMetaData>/s);
            if (match && !match[1].includes("NOT_IMPLEMENTED")) {
              const mMeta = parseTrackMeta(match[1], m.host);
              if (mMeta.title) {
                meta = mMeta;
                console.log(`🎵 Metadata found via member ${m.name}`);
                break;
              }
            }
          } catch {}
        }
      }

      track = { ...track, ...meta };
    } catch {}

    // ──────────── MediaInfo fallback ────────────
    try {
      const media = await coord.AVTransportService.GetMediaInfo();
      const meta = parseTrackMeta(
        media.CurrentURIMetaData || media.EnqueuedTransportURIMetaData,
        coord.Host
      );
      track.title ||= meta.title;
      track.artist ||= meta.artist;
      track.album ||= meta.album;
      track.artwork ||= meta.artwork;
    } catch {}

    // ──────────── Source + artwork fallbacks ────────────
    if (!track.artwork && track.uri?.includes("spotify:track:")) {
      const idMatch = track.uri.match(/spotify:track:([A-Za-z0-9]+)/);
      if (idMatch) {
        const id = idMatch[1];
        track.artwork = `https://i.scdn.co/image/${id}`;
      }
    }
    if (!track.artwork && track.uri?.includes("tunein:")) {
      track.artwork = "/cache/artwork/tunein-default.jpg";
    }

    track.source = track.uri.includes("spotify")
      ? "Spotify"
      : track.uri.includes("tunein")
      ? "TuneIn"
      : track.uri.includes("sonos")
      ? "Sonos Radio"
      : "Sonos Queue";

    const artFile = await cacheArtwork(track.artwork);
    if (artFile) track.artwork = artFile;

    // ──────────── Volume averaging ────────────
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

    results.push({
      name: `${members[0]?.name}${
        members.length > 1 ? " +" + (members.length - 1) : ""
      }`,
      coordinator: coordId,
      status: state,
      track,
      avgVolume,
      members,
    });
  }

  console.log(`✅ Parsed ${results.length} groups with rich metadata`);
  return results;
}


  // ───────────────────────────────
  // Routes
  // ───────────────────────────────

  router.get("/discover", async (_req, res) => {
    try {
      await ensureManager(true);
      res.json({
        ok: true,
        devices: manager.Devices?.length ?? 0,
        zones: manager.Zones?.length ?? 0,
      });
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

  router.all("/volume", async (req, res) => {
    try {
      const { group, level } = req.method === "POST" ? req.body : req.query;
      const mgr = await ensureManager();
      const zone = mgr.Zones.find(
        (z) => z.Name.toLowerCase() === group?.toLowerCase()
      );
      if (!zone) throw new Error("Group not found");
      const coord = zone.CoordinatorDevice;

      if (level !== undefined) {
        const v = Number(level);
        if (isNaN(v) || v < 0 || v > 100)
          throw new Error("Volume must be 0–100");
        await coord.RenderingControlService.SetGroupVolume(v);
        res.json({ ok: true, group, volume: v });
      } else {
        const v = await coord.RenderingControlService.GetGroupVolume();
        res.json({ group, volume: v });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/play", async (req, res) => {
    try {
      const { group } = req.body;
      const mgr = await ensureManager();
      const zone = mgr.Zones.find(
        (z) => z.Name.toLowerCase() === group?.toLowerCase()
      );
      if (!zone) throw new Error("Group not found");
      await zone.CoordinatorDevice.AVTransportService.Play();
      res.json({ ok: true, action: "play", group });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/pause", async (req, res) => {
    try {
      const { group } = req.body;
      const mgr = await ensureManager();
      const zone = mgr.Zones.find(
        (z) => z.Name.toLowerCase() === group?.toLowerCase()
      );
      if (!zone) throw new Error("Group not found");
      await zone.CoordinatorDevice.AVTransportService.Pause();
      res.json({ ok: true, action: "pause", group });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
