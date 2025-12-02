// ------------------------------------------------------------
// 📁 Slideshow Config Loader
// ------------------------------------------------------------

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { CONFIG_DIR } from "../../shared/paths.js";

const CONFIG_FILE = path.join(CONFIG_DIR, "slideshow-config.yaml");

export function loadSlideshowConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      throw new Error(`Slideshow config not found: ${CONFIG_FILE}`);
    }

    const text = fs.readFileSync(CONFIG_FILE, "utf8");
    const cfg = yaml.load(text);

    if (!cfg.slides || !Array.isArray(cfg.slides)) {
      throw new Error("Config missing 'slides' array");
    }

    cfg.clients ||= {};
    cfg.default ||= {};

    return cfg;
  } catch (err) {
    console.error("❌ Error loading slideshow config:", err);
    throw err;
  }
}
