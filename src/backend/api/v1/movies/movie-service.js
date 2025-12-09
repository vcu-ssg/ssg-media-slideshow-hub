// ------------------------------------------------------------
// 🎬 movie-service.js — Logic layer for movie resolution
// ------------------------------------------------------------
import fs from "fs";
import path from "path";
import { MOVIES_DIR } from "../../../shared/paths.js";
import { movieRegistry } from "./movie-registry.js";

// Movies live at: <project>/media/movies
const MOVIE_ROOT = MOVIES_DIR

export function listMovieFolders() {
  if (!fs.existsSync(MOVIE_ROOT)) return [];

  return fs
    .readdirSync(MOVIE_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

export function resolveMovieFile(folderName) {
  const folderPath = path.join(MOVIE_ROOT, folderName);

  if (!fs.existsSync(folderPath)) {
    throw new Error(`Movie folder not found: ${folderPath}`);
  }

  const files = fs.readdirSync(folderPath);
  const movie =
    files.find((f) => f.toLowerCase().endsWith(".mkv")) ||
    files.find((f) => f.toLowerCase().endsWith(".mp4"));

  if (!movie) {
    throw new Error(`No MKV/MP4 found in folder: ${folderPath}`);
  }

  // IMPORTANT: Return the URL—not the filesystem path.
  return `/media/movies/${encodeURIComponent(folderName)}/${encodeURIComponent(movie)}`;
}

// ------------------------------------------------------------
// Registration API — called by slideshow builder or others
// ------------------------------------------------------------
export function registerMovie(id, filePath) {
  movieRegistry[id] = filePath;
  return filePath;
}

export function getMoviePath(id) {
  return movieRegistry[id] || null;
}
