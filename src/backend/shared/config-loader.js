// ------------------------------------------------------------
// Shared Config Loader (generic)
// ------------------------------------------------------------

import fs from "fs";
import yaml from "js-yaml";
import { SLIDESHOW_CONFIG_FILE } from "./paths.js";

export function loadSlideshowConfig() {
  try {
    if (!fs.existsSync(SLIDESHOW_CONFIG_FILE)) {
      throw new Error(`Slideshow config not found: ${SLIDESHOW_CONFIG_FILE}`);
    }

    const text = fs.readFileSync(SLIDESHOW_CONFIG_FILE, "utf8");
    const cfg = yaml.load(text);

    cfg.clients ||= {};
    cfg.default ||= {};

    return cfg;
  } catch (err) {
    console.error("❌ Error loading slideshow config:", err);
    throw err;
  }
}
