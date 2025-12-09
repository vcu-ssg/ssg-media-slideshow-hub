// ------------------------------------------------------------
// 📽️ Slideshow Router (API v1)
// ------------------------------------------------------------

import { Router } from "express";
import { loadSlideshowConfig } from "../../../shared/config-loader.js";
import { buildSlideshowForClient } from "./slideshow-service.js";

const router = Router();

// GET /api/v1/slideshow?slideshow=frontporch
router.get("/", async (req, res) => {
  try {
    const slideshow = (req.query.slideshow || "default").toLowerCase();

    const config = loadSlideshowConfig();
    const slides = await buildSlideshowForClient(slideshow, config);

    res.json({
      ok: true,
      slideshow,
      count: slides.length,
      slides,
    });
  } catch (err) {
    console.error("❌ Slideshow error:", err);
    res.status(500).json({ error: err.message || "Slideshow error" });
  }
});

export default router;