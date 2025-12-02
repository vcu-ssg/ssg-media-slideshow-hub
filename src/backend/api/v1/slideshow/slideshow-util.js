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

  // Clone before mutation
  const s = { ...slide };

  // --------------------------------------------
  // ID — keep original ID if provided (MUX relies on IDs)
  // --------------------------------------------
  if (!s.id) s.id = `slide_${_autoId++}`;

  // --------------------------------------------
  // Type detection
  // Order matters: more specific → more general
  // --------------------------------------------
  const rawType = (s.type || "").toLowerCase();

  let type = rawType || "image";

  // Highest-precedence explicit types
  if (["mux", "youtube", "html", "folder", "movie", "pause"].includes(type)) {
    s.type = type;
    applyDefaults(s);
    return s;
  }

  // Google / OneDrive explicit types
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

  // Remote URL
  if (s.file && /^https?:\/\//i.test(s.file)) {
    s.type = "remote-image";
    applyDefaults(s);
    return s;
  }

  // Multi-frame: *.JPG, *.png, etc.
  if (s.file && s.file.includes("*")) {
    s.type = "multi-frame";
    applyDefaults(s);
    return s;
  }

  // Movie URLs or video extension
  if (rawType === "video") {
    s.type = "video";
    applyDefaults(s);
    return s;
  }

  // Single still local image
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
