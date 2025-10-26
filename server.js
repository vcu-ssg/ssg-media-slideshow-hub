// ------------------------------------------------------------
// 📸 Photo Kiosk Server – Modularized Weather API (Node 22 native fetch)
// ------------------------------------------------------------
import express from "express";
import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import os from "os";
import morgan from "morgan";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { minimatch } from "minimatch";
import { glob } from "glob";
import sharp from "sharp";
import { createWeatherRouter } from "./weatherapi.js"; // ✅ modular import
import { listGoogleImages } from "./googleimages.js";
import { listOneDriveImages } from "./onedriveimages.js";


// ------------------------------------------------------------
// 🧭 Environment setup
// ------------------------------------------------------------
dotenv.config({ path: process.env.ENV_PATH || "/home/john/.env" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = process.env.KIOSK_PORT || process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID || os.hostname() || "default-client";
const OPENWEATHER_KEY =
  process.env.KIOSK_OPENWEATHER_KEY || process.env.OPENWEATHER_KEY || "";

// ------------------------------------------------------------
// 📂 Directory setup
// ------------------------------------------------------------
const PHOTOS_DIR = path.join(__dirname, "photos");
const CACHE_DIR = path.join(__dirname, "cache");
const LOG_DIR = path.join(__dirname, "logs");
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });

// ------------------------------------------------------------
// 🪵 Logging
// ------------------------------------------------------------
const LOG_FILE = path.join(LOG_DIR, "access.log");
const accessStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
app.use(morgan("combined", { stream: accessStream }));

function log(msg) {
  const ts = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `${ts} | ${msg}\n`);
}

// ------------------------------------------------------------
// ⚙️ Load config.yaml
// ------------------------------------------------------------
const CONFIG_PATH = path.join(__dirname, "config.yaml");
let config = {};
try {
  const text = fs.readFileSync(CONFIG_PATH, "utf8");
  config = yaml.load(text);
  if (!config.default) config.default = { include: ["*.JPG", "*.jpg", "*.png"] };
  if (!config.clients) config.clients = {};
  log(`✅ Loaded config.yaml from ${CONFIG_PATH}`);
} catch (err) {
  console.warn("⚠️ Could not load config.yaml — using defaults:", err.message);
  config = { default: { include: ["*.JPG", "*.jpg", "*.png"] }, clients: {} };
}

// ------------------------------------------------------------
// 🌐 Static routes
// ------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));
app.use("/photos", express.static(PHOTOS_DIR));
app.use("/cache", express.static(CACHE_DIR));
app.use("/pages", express.static(path.join(__dirname, "pages")));

// ------------------------------------------------------------
// 🔍 Helpers
// ------------------------------------------------------------
async function ensureCached(filePath, maxWidth = 1920, maxHeight = 1080) {
  try {
    const relPath = path.relative(PHOTOS_DIR, filePath);
    const cachedPath = path.join(CACHE_DIR, relPath);
    fs.mkdirSync(path.dirname(cachedPath), { recursive: true });

    if (!fs.existsSync(cachedPath)) {
      const image = sharp(filePath);
      const meta = await image.metadata();
      if (meta.width > maxWidth || meta.height > maxHeight) {
        await image
          .rotate(0)
          .resize({
            width: Math.min(meta.width, maxWidth),
            height: Math.min(meta.height, maxHeight),
            fit: "inside",
            withoutEnlargement: true,
          })
          .withMetadata({ orientation: 1 })
          .toFile(cachedPath);
        log(`🖼️ Cached resized ${relPath}`);
      } else fs.copyFileSync(filePath, cachedPath);
    }
    return `/cache/${relPath.replace(/\\/g, "/")}`;
  } catch (err) {
    console.error("⚠️ Cache error:", err);
    return `/photos/${path.relative(PHOTOS_DIR, filePath).replace(/\\/g, "/")}`;
  }
}

async function prepareFrames(pattern) {
  const matches = (await glob(pattern, { cwd: PHOTOS_DIR })).sort();
  const full = matches.map((f) => path.join(PHOTOS_DIR, f));
  const cached = [];
  for (const f of full) cached.push(await ensureCached(f));
  return cached;
}

// ------------------------------------------------------------
// 🧩 Build slideshow JSON
// ------------------------------------------------------------
async function buildSlideshow(clientId) {
  const masterSlides = config.slides || [];
  const clients = config.clients || {};
  const defaultCfg = config.default || {};
  const clientCfg = clients[clientId] || defaultCfg;

  const includeIds = clientCfg.include || defaultCfg.include || [];
  const expanded = [];

  for (const id of includeIds.length ? includeIds : masterSlides.map((s) => s.id)) {
    const slide = masterSlides.find((s) => s.id === id);
    if (!slide) continue;

    // --- MUX container ---
    if (slide.type === "mux") {
      expanded.push(slide);
      const addRef = (ids, seen = new Set()) => {
        for (const rid of ids) {
          if (seen.has(rid)) continue;
          const child = masterSlides.find((s) => s.id === rid);
          if (!child) continue;
          seen.add(rid);
          expanded.push(child);
          if (child.type === "mux" && child.panels) {
            addRef(child.panels.flatMap((p) => p.slides || []), seen);
          }
        }
      };
      addRef(slide.panels.flatMap((p) => p.slides || []));
      continue;
    }

    // --- HTML page ---
    if (slide.type === "html") {
      expanded.push({
        id,
        type: "html",
        url: slide.url,
        duration: slide.duration || 10,
        title: slide.title || "",
      });
      continue;
    }

    // --- YouTube ---
    if (slide.type === "youtube") {
      expanded.push({
        id,
        type: "youtube",
        video_id: slide.video_id,
        duration: slide.duration || 30,
        title: slide.title || "",
      });
      continue;
    }

    // --- GOOGLE DRIVE SLIDES ---
    if (slide.type === "google-drive") {
      const { folderId, files, order, duration, title } = slide;
      try {
        const items = await listGoogleImages({ folderId, files, order });
        log(`🧩 listGoogleImages(${id}) returned ${items.length} images`);
        expanded.push({
          id,
          type: "google-drive",
          folderId,
          order,
          duration: duration || 10,
          title: title || "",
          images: items,
        });
      } catch (err) {
        const msg = `❌ Error building Google Drive slide '${id}': ${err.message}`;
        console.error(msg);
        log(msg);
      }
      continue;
    }

    // --- ONEDRIVE SLIDES ---
    if (slide.type === "one-drive") {
      const { id, folder, order, duration, title, effect } = slide;
      try {
        const items = await listOneDriveImages({ folderPath: folder, order });
        log(`🧩 listOneDriveImages(${id}) returned ${items.length} images`);

        expanded.push({
          id,
          type: "one-drive",
          folder,
          order,
          effect: effect || "fade",
          duration: duration || 10,
          title: title || "",
          images: items,
        });
      } catch (err) {
        const msg = `❌ Error building OneDrive slide '${id}': ${err.message}`;
        console.error(msg);
        log(msg);
      }
      continue;
    }


    // --- Multi-frame sequence ---
    if (slide.file?.includes("*")) {
      const frames = await prepareFrames(slide.file);
      expanded.push({
        id,
        frames,
        file: slide.file,
        effect: slide.effect || "animate-smooth",
        duration:
          slide.duration || (frames.length * (slide.repeat || 1)) / (slide.fps || 10),
        fps: slide.fps || 10,
        repeat: slide.repeat || 1,
        title: slide.title || "",
      });
      continue;
    }

    // --- Single still ---
    if (slide.file) {
      const imgPath = path.join(PHOTOS_DIR, slide.file);
      if (fs.existsSync(imgPath)) {
        const url = await ensureCached(imgPath);
        expanded.push({
          id,
          url,
          file: slide.file,
          effect: slide.effect || "fade",
          duration: slide.duration || 5,
          fps: slide.fps || 10,
          repeat: slide.repeat || 1,
          title: slide.title || "",
        });
      }
    }
  }

  // ------------------------------------------------------------
  // 🧩 Inject Google Drive images into slides inside MUX panels
  // ------------------------------------------------------------
  for (const slide of expanded) {
    if (slide.type === "mux" && slide.panels) {
      for (const panel of slide.panels) {
        for (const sid of panel.slides || []) {
          const ref = expanded.find((s) => s.id === sid);

          if (ref && ref.type === "google-drive" && !ref.images?.length) {
            try {
              const items = await listGoogleImages({
                folderId: ref.folderId,
                order: ref.order,
              });
              ref.images = items;
              log(
                `🔁 Injected ${items.length} Google Drive images into ${sid} for mux panel`
              );
            } catch (err) {
              log(`❌ Mux injection failed for ${sid}: ${err.message}`);
            }
          }

          if (ref && ref.type === "one-drive" && !ref.images?.length) {
            try {
              const items = await listOneDriveImages({
                folderPath: ref.folder,
                order: ref.order,
              });
              ref.images = items;
              log(
                `🔁 Injected ${items.length} OneDrive images into ${sid} for mux panel`
              );
            } catch (err) {
              log(`❌ Mux injection failed for ${sid}: ${err.message}`);
            }
          }

        }
      }
    }
  }

  log(`✅ Built slideshow for ${clientId}: ${expanded.length} slides total`);
  return expanded;
}

// ------------------------------------------------------------
// 📡 API: slideshow
// ------------------------------------------------------------
app.get("/api/slideshow", async (req, res) => {
  try {
    const slides = await buildSlideshow(CLIENT_ID);
    res.json({ slides });
  } catch (err) {
    console.error("❌ Error building slideshow:", err);
    res.status(500).json({ error: "Error building slideshow" });
  }
});

// ------------------------------------------------------------
// 📸 API: frames (for wildcard sequences)
// ------------------------------------------------------------
app.get("/api/frames", async (req, res) => {
  const { pattern } = req.query;
  if (!pattern) return res.json({ frames: [] });
  try {
    const matches = (await glob(pattern, { cwd: PHOTOS_DIR })).sort();
    const frames = await Promise.all(
      matches.map(async (f) => await ensureCached(path.join(PHOTOS_DIR, f)))
    );
    res.json({ frames });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// 🖼️ API: single image resolver (Ken Burns fix)
// ------------------------------------------------------------
app.get("/api/image", async (req, res) => {
  const { file } = req.query;
  if (!file) return res.status(400).json({ error: "Missing file" });
  try {
    const abs = path.join(PHOTOS_DIR, file);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "Not found" });
    const url = await ensureCached(abs);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// 🌦️ Mount modular weather API
// ------------------------------------------------------------
app.use("/api/weather", createWeatherRouter(express, OPENWEATHER_KEY, log));

// ------------------------------------------------------------
// 🚀 Start server
// ------------------------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`📸 Photo kiosk running at http://localhost:${PORT}`);
  console.log(`🧭 Client ID: ${CLIENT_ID}`);
  console.log(`🪵 Log file: ${LOG_FILE}`);
  console.log(`💾 Cache dir: ${CACHE_DIR}`);
  console.log(`🌤️ Weather key loaded: ${!!OPENWEATHER_KEY}`);
});

if (server instanceof Promise) {
  server.then(() => console.log("✅ Express server listening.")).catch(console.error);
}
