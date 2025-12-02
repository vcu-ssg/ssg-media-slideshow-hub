// ------------------------------------------------------------
// Shared backend paths
// ------------------------------------------------------------
import path from "path";
import { fileURLToPath } from "url";

// __dirname of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Backend root
export const BACKEND_ROOT = path.join(__dirname, "..");

// Project root (backend/..)
export const PROJECT_ROOT = path.join(BACKEND_ROOT, "..","..");

// Public directory (express static)
export const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
console.log("📁 PUBLIC_DIR resolved to:", PUBLIC_DIR);

// Media directory (/media)
export const MEDIA_DIR = path.join(PROJECT_ROOT, "media");

// Published media subdirectories
export const MOVIES_DIR = path.join(MEDIA_DIR, "movies");
export const PHOTOS_DIR = path.join(MEDIA_DIR, "photos");
export const TV_DIR = path.join(MEDIA_DIR, "tv");
export const VIDEOS_DIR = path.join(MEDIA_DIR, "videos");

// Runtime directory (/runtime)
export const RUNTIME_DIR = path.join(PROJECT_ROOT, "runtime");

// Slideshow configuration YAML
export const SLIDESHOW_CONFIG_FILE = path.join(
  BACKEND_ROOT,
  "config",
  "slideshow-config.yaml"
);
