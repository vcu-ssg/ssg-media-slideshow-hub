// ------------------------------------------------------------
// 🧰 Slideshow Utility Helpers (v3, MUX-safe)
// ------------------------------------------------------------

import fs from "fs";
import path from "path";
import { PHOTOS_DIR } from "../../../shared/paths.js";

// ------------------------------------------------------------
// LOCAL PHOTO LISTING (IMPROVED)
// ------------------------------------------------------------
//
// Accepts either:
//   • listLocalPhotos()                → scans PHOTOS_DIR
//   • listLocalPhotos("kitchen/*.jpg") → absolute glob-like
//   • listLocalPhotos("kitchen")       → scans PHOTOS_DIR/kitchen
//
// Returns absolute file paths.
//
export function listLocalPhotos(folder = "") {
  let dir = PHOTOS_DIR;

  if (folder && typeof folder === "string") {
    // Allow sub-folders under photos/
    const sub = path.join(PHOTOS_DIR, folder);
    if (fs.existsSync(sub) && fs.statSync(sub).isDirectory()) {
      dir = sub;
    }
  }

  return fs
    .readdirSync(dir)
    .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
    .map((f) => path.join(dir, f));
}

// ------------------------------------------------------------
// SLIDE NORMALIZATION (IMPROVED + MUX-SAFE)
// ------------------------------------------------------------
//
// Key improvements:
//   ✔ DOES NOT append unique suffix to IDs — this broke MUX
//   ✔ Detects all known types centrally
//   ✔ Only assigns auto-ID when missing
//   ✔ Duration/effect defaults applied safely
//   ✔ Never mutates original slide
//
let _autoId = 1;

export function normalizeSlide(slide) {
  if (!slide || typeof slide !== "object") return null;

  // Clone before mutation (MUX-safe)
  const s = { ...slide };

  // ------------------------------------------------------------
  // ID — required for MUX and indexing
  // ------------------------------------------------------------
  if (!s.id) s.id = `slide_${_autoId++}`;

  // ------------------------------------------------------------
  // Extract raw type (lowercased)
  // ------------------------------------------------------------
  const rawType = (s.type || "").toLowerCase();

  // ------------------------------------------------------------
  // EXPLICIT TYPES (highest priority — never override)
  // ------------------------------------------------------------
  if (["mux", "youtube", "html", "folder", "movie", "pause"].includes(rawType)) {
    s.type = rawType;
    applyDefaults(s);
    return s;
  }

  if (rawType === "google-drive" || rawType === "google") {
    s.type = "google-drive";
    applyDefaults(s);
    return s;
  }

  if (rawType === "one-drive" || rawType === "onedrive") {
    s.type = "one-drive";
    applyDefaults(s);
    return s;
  }

  // ------------------------------------------------------------
  // WEBPAGE DETECTION
  //
  // Two cases:
  //   1. YAML explicitly uses: type: webpage
  //   2. Slide has url: ... AND does NOT have a file: field
  //
  // This fixes your issue.
  // ------------------------------------------------------------
  if (rawType === "webpage" || (s.url && !s.file)) {
    s.type = "webpage";
    applyDefaults(s);
    return s;
  }

  // ------------------------------------------------------------
  // REMOTE IMAGE (file begins with http/https)
  // ------------------------------------------------------------
  if (s.file && /^https?:\/\//i.test(s.file)) {
    s.type = "remote-image";
    applyDefaults(s);
    return s;
  }

  // ------------------------------------------------------------
  // MULTI-FRAME (“file: *.jpg”, “*.png”, etc.)
  // ------------------------------------------------------------
  if (s.file && s.file.includes("*")) {
    s.type = "multi-frame";
    applyDefaults(s);
    return s;
  }

  // ------------------------------------------------------------
  // BASIC VIDEO (rarely used: type: video)
  // ------------------------------------------------------------
  if (rawType === "video") {
    s.type = "video";
    applyDefaults(s);
    return s;
  }

  // ------------------------------------------------------------
  // FALLBACK — LOCAL IMAGE
  //
  // This is the DEFAULT ONLY if:
  //   • slide has file: ..., AND
  //   • is not a video/multi-frame/remote-image
  // ------------------------------------------------------------
  if (s.file) {
    s.type = "image";
    applyDefaults(s);
    return s;
  }

  // ------------------------------------------------------------
  // FINAL FALLBACK (should rarely occur)
  // Treat unknown/no-file slides as simple images
  // ------------------------------------------------------------
  s.type = "image";
  applyDefaults(s);
  return s;
}

// ------------------------------------------------------------
// Apply slide defaults safely
// ------------------------------------------------------------
function applyDefaults(s) {
  if (!s.duration && s.duration !== 0) s.duration = 10;
  if (!s.effect) s.effect = "fade";
  return s;
}

// ------------------------------------------------------------
// CLIENT OVERRIDES (UNCHANGED)
// ------------------------------------------------------------

export function applyClientOverrides(slide, clientCfg) {
  if (!clientCfg?.overrides) return slide;

  // Overrides are matched on ORIGINAL IDs (MUX-safe)
  const override = clientCfg.overrides[slide.id];
  return override ? { ...slide, ...override } : slide;
}
