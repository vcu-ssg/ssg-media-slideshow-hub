// ------------------------------------------------------------
// 📽️ Slideshow Router (API v1)
// ------------------------------------------------------------

import { Router } from "express";
import { loadSlideshowConfig } from "../../../shared/config-loader.js";
import { buildSlideshowForClient } from "./slideshow-service.js";

const router = Router();

// GET /api/v1/slideshow?client=frontporch
router.get("/", async (req, res) => {
  try {
    const client = (req.query.client || "default").toLowerCase();

    const config = loadSlideshowConfig();
    const slides = await buildSlideshowForClient(client, config);

    res.json({
      ok: true,
      client,
      count: slides.length,
      slides,
    });
  } catch (err) {
    console.error("❌ Slideshow error:", err);
    res.status(500).json({ error: err.message || "Slideshow error" });
  }
});

export default router;
