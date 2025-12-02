// ------------------------------------------------------------
// 🎬 Movie Streaming + Listing Router
// ------------------------------------------------------------
import fs from "fs";
import path from "path";
import { movieRegistry } from "./registry.js";

const MOVIE_ROOT = "/mnt/dockermedia/media/movies";

export function createMovieRouter(express, log) {
  const router = express.Router();

  // ------------------------------------------------------------
  // 📄 GET /api/movie/list
  //     Returns a list of subfolders inside MOVIE_ROOT
  // ------------------------------------------------------------
  router.get("/list", (req, res) => {
    try {
      const entries = fs.readdirSync(MOVIE_ROOT, { withFileTypes: true });

      const folders = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));

      res.json({ movies: folders });
    } catch (err) {
      const msg = `❌ Error listing movie folders: ${err.message}`;
      console.error(msg);
      log(msg);
      res.status(500).json({ error: msg });
    }
  });

  // ------------------------------------------------------------
  // 🎥 GET /api/movie/id/:id
  //     Streams a movie based on its registered ID
  // ------------------------------------------------------------
  router.get("/id/:id", (req, res) => {
    const id = req.params.id;
    const moviePath = movieRegistry[id];

    if (!moviePath) {
      const msg = `❌ Movie not found for ID '${id}'`;
      log(msg);
      return res.status(404).send(msg);
    }

    try {
      const stat = fs.statSync(moviePath);
      const range = req.headers.range;

      // No range → return entire file
      if (!range) {
        res.writeHead(200, {
          "Content-Length": stat.size,
          "Content-Type": "video/mp4",
        });
        fs.createReadStream(moviePath).pipe(res);
        return;
      }

      // Parse range: "bytes=start-end"
      const [startStr, endStr] = range.replace("bytes=", "").split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": "video/mp4",
      });

      fs.createReadStream(moviePath, { start, end }).pipe(res);

    } catch (err) {
      const msg = `❌ Streaming error for movie '${id}': ${err.message}`;
      console.error(msg);
      log(msg);
      res.status(500).send("Error streaming movie");
    }
  });

  return router;
}
