import express from "express";
import morgan from "morgan";
import dotenv from "dotenv";

import { PUBLIC_DIR, MEDIA_DIR, RUNTIME_DIR, PHOTOS_DIR, PROJECT_ROOT, MOVIES_DIR } from "./shared/paths.js";

// API v1 Routers
import slideshowRouter from "./api/v1/slideshow/slideshow-router.js";
import movieRouter from "./api/v1/movies/movie-router.js";
import sonosRouter from "./api/v1/sonos/sonos-router.js";

import weatherRouter from "./api/v1/weather/openweather-router.js";
import wundergroundRouter from "./api/v1/weather/wunderground-router.js";
import visualcrossingRouter from "./api/v1/weather/visualcrossing-router.js";
import meteobridgeRouter from "./api/v1/weather/meteobridge-router.js";
import framesRouter from "./api/v1/frames/frames-router.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

import path from "path";

console.log("PROJECT_ROOT =", PROJECT_ROOT);
console.log("MEDIA_DIR    =", MEDIA_DIR);
console.log("PHOTOS_DIR   =", PHOTOS_DIR);
console.log("MOVIES_DIR =", MOVIES_DIR);

// middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("combined"));

// static
app.use(express.static(PUBLIC_DIR));
app.use("/media", express.static(MEDIA_DIR));
app.use("/runtime", express.static(RUNTIME_DIR));
app.use("/media/photos", express.static(PHOTOS_DIR));
app.use("/media/movies", express.static(MOVIES_DIR));

// Mount slideshow generic and versioned
app.use("/api/slideshow", slideshowRouter);
app.use("/api/v1/slideshow", slideshowRouter);
app.use("/api/frames", framesRouter);
app.use("/api/v1/frames", framesRouter);

// mount versioned API
app.use("/api/v1/movie", movieRouter);
app.use("/api/v1/sonos", sonosRouter);
app.use("/api/v1/weather", weatherRouter);
app.use("/api/v1/wunder", wundergroundRouter);
app.use("/api/v1/visualcrossing", visualcrossingRouter);
app.use("/api/v1/meteobridge", meteobridgeRouter);

app.listen(PORT, () =>
  console.log(`🚀 API v1 server running on port ${PORT}`)
);
