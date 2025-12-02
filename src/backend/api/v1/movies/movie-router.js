// ------------------------------------------------------------
// 🎬 Movie Router (API v1)
// ------------------------------------------------------------

import fs from "fs";
import path from "path";
import { Router } from "express";

import {
  listMovieFolders,
  getMoviePath
} from "./movie-service.js";

const router = Router();

// ------------------------------------------------------------
// GET /api/v1/movie/list
// ------------------------------------------------------------
router.get("/list", (req, res) => {
  try {
    const movies = listMovieFolders();
    res.json({ movies });
  } catch (err) {
    console.error("❌ Error listing movies:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// GET /api/v1/movie/id/:id
// Streams file with proper byte-range support
// ------------------------------------------------------------
router.get("/id/:id", (req, res) => {
  const id = req.params.id;
  const moviePath = getMoviePath(id);

  if (!moviePath) {
    return res.status(404).json({ error: `Movie not registered: ${id}` });
  }

  try {
    const stat = fs.statSync(moviePath);
    const range = req.headers.range;

    if (!range) {
      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": "video/mp4",
      });
      return fs.createReadStream(moviePath).pipe(res);
    }

    // Parse Range header
    const [startStr, endStr] = range.replace("bytes=", "").split("-");
    const start = parseInt(startStr);
    const end = endStr ? parseInt(endStr) : stat.size - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": "video/mp4",
    });

    fs.createReadStream(moviePath, { start, end }).pipe(res);
  } catch (err) {
    console.error(`❌ Error streaming '${id}':`, err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
