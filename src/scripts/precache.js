// -------------------------------------------
// scripts/precache.js
// Pre-cache all images under ./photos
// Run via: make pre-cache
// -------------------------------------------

import fs from "fs";
import path from "path";
import { glob } from "glob";
import sharp from "sharp";

const __dirname = path.resolve();
const PHOTOS_DIR = path.join(__dirname, "photos");
const CACHE_DIR = path.join(__dirname, "cache");

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;

fs.mkdirSync(CACHE_DIR, { recursive: true });

function log(msg) {
  console.log("📦", msg);
}

async function ensureCached(filePath) {
  const rel = path.relative(PHOTOS_DIR, filePath);
  const dest = path.join(CACHE_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (fs.existsSync(dest)) return; // skip if already cached

  try {
    const img = sharp(filePath);
    const meta = await img.metadata();

    if (meta.width > MAX_WIDTH || meta.height > MAX_HEIGHT) {
      await img
        .rotate() // prevent EXIF auto-rotation
        .resize({
          width: Math.min(meta.width, MAX_WIDTH),
          height: Math.min(meta.height, MAX_HEIGHT),
          fit: "inside",
          withoutEnlargement: true,
        })
        .withMetadata() // clear EXIF orientation tag
        .toFile(dest);
      log(`Resized ${rel}`);
    } else {
      fs.copyFileSync(filePath, dest);
    }
  } catch (err) {
    console.error(`⚠️ Error caching ${filePath}:`, err.message);
  }
}

async function main() {
  console.log("🔧 Scanning all images under ./photos...");

  // Collect and sort all image files
  const exts = ["jpg", "jpeg", "png", "gif", "webp", "tiff"];
  const patterns = exts.map((e) => `**/*.${e}`);
  const allFiles = (
    await Promise.all(patterns.map((pat) => glob(pat, { cwd: PHOTOS_DIR })))
  )
    .flat()
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (allFiles.length === 0) {
    console.warn("⚠️ No image files found in ./photos.");
    return;
  }

  const start = Date.now();
  let processed = 0;

  for (const f of allFiles) {
    await ensureCached(path.join(PHOTOS_DIR, f));
    processed++;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✅ Cached ${processed} images in ${elapsed}s`);
}

main();
