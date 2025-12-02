import express from "express";
import path from "path";
import { globSync } from "glob";
import { PHOTOS_DIR } from "../../../shared/paths.js";

const router = express.Router();

router.get("/", (req, res) => {
  console.log("📸 /api/frames HIT", req.query);
  console.log("📁 PHOTOS_DIR =", PHOTOS_DIR);

  const pattern = req.query.pattern;
  console.log("📄 pattern =", pattern);

  if (!pattern) {
    return res.status(400).json({ error: "Missing ?pattern=" });
  }

  const fullPattern = path.join(PHOTOS_DIR, pattern);
  console.log("📌 fullPattern =", fullPattern);

  try {
    const files = globSync(fullPattern, { nodir: true });  // ← FIX

    console.log("🔍 globSync found:", files.length, "files");
    console.log(files); // optional debug

    const frames = files.map(abs => {
      const rel = abs.replace(PHOTOS_DIR, "").replace(/^[\\/]/, "");
      return `/photos/${rel}`;
    });

    res.json({ frames });
  } catch (e) {
    console.error("globSync error:", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
