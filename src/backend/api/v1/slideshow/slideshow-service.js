// ------------------------------------------------------------
// 🖼️ Slideshow Builder Service (API v3)
// ------------------------------------------------------------

import { listLocalPhotos } from "./slideshow-util.js";
import { normalizeSlide, applyClientOverrides } from "./slideshow-util.js";

import { listGoogleImages } from "../images/google-images.js";
import { listOneDriveImages } from "../images/onedrive-images.js";
import { resolveMovieFile } from "../movies/movie-service.js";

// ------------------------------------------------------------
// BUILD SLIDESHOW FOR CLIENT
// ------------------------------------------------------------

export async function buildSlideshowForClient(slideshow, config) {
  const master = config.slides || [];
  const slideshows = config.slideshows || {};
  const clientCfg = slideshows[slideshow] || {};
  const defaultCfg = config.slideshows.default || {};

  // ENTRY SLIDES
  const includeIds =
    clientCfg.include ||
    defaultCfg.include ||
    [];

  const entryIds =
    includeIds.length > 0
      ? includeIds
      : master.map((s) => s.id);

  const expanded = [];
  const seen = new Set();

  const findMaster = (id) => master.find((s) => s.id === id);

  // ------------------------------------------------------------
  // Add slide (with recursive MUX traversal)
  // ------------------------------------------------------------

  const addSlideOnce = async (slideId) => {
    if (seen.has(slideId)) return;
    seen.add(slideId);

    const raw = findMaster(slideId);
    if (!raw) return;

    // normalize + client overrides
    let slide = normalizeSlide(raw);
    slide = applyClientOverrides(slide, clientCfg);

    const type = (slide.type || "").toLowerCase();

    switch (type) {
      // --------------------------------------------------------
      // MULTI-FRAME (single slide object with frames[])
      // --------------------------------------------------------
      case "multi-frame":
        expanded.push(slide);
        return;

      // --------------------------------------------------------
      // SIMPLE IMAGE (no expansion)
      // --------------------------------------------------------
      case "image":
      case "remote-image":
        expanded.push(slide);
        return;

      // --------------------------------------------------------
      // HTML
      // --------------------------------------------------------
      case "html":
        expanded.push(expandHtml(slide));
        return;

      // --------------------------------------------------------
      // YOUTUBE
      // --------------------------------------------------------
      case "youtube":
        expanded.push(expandYouTube(slide));
        return;

      // --------------------------------------------------------
      // LOCAL FOLDER
      // --------------------------------------------------------
      case "folder": {
        const list = expandLocalFolder(slide);
        replaceOrAppend(expanded, slide.id, list);
        return;
      }

      // --------------------------------------------------------
      // GOOGLE DRIVE
      // --------------------------------------------------------
      case "google":
      case "google-drive": {
        const list = await expandGoogle(slide);
        replaceOrAppend(expanded, slide.id, list);
        return;
      }

      // --------------------------------------------------------
      // ONEDRIVE
      // --------------------------------------------------------
      case "onedrive":
      case "one-drive": {
        const list = await expandOneDrive(slide);
        replaceOrAppend(expanded, slide.id, list);
        return;
      }

      // --------------------------------------------------------
      // MOVIE
      // --------------------------------------------------------
      case "movie": {
        expanded.push(await expandMovie(slide));
        return;
      }

      // --------------------------------------------------------
      // MUX — recursively add panel slides
      // --------------------------------------------------------
      case "mux": {
        expanded.push(slide);

        const childIds =
          slide.panels?.flatMap((p) => p.slides || []) || [];

        for (const cid of childIds) {
          await addSlideOnce(cid);
        }
        return;
      }

      // --------------------------------------------------------
      // PAUSE
      // --------------------------------------------------------
      case "pause":
        expanded.push({
          id: slide.id,
          type: "pause",
          duration: slide.duration || 1,
        });
        return;

      // --------------------------------------------------------
      default:
        console.warn(`⚠️ Unknown slide type '${slide.type}'`);
        expanded.push(slide);
        return;
    }
  };

  // Expand entry slides
  for (const id of entryIds) {
    await addSlideOnce(id);
  }

  // Inject Google / OneDrive images into MUX panels
  await injectPanelAssets(expanded);

  return expanded;
}

// ------------------------------------------------------------
// Utility: Replace placeholder or append
// ------------------------------------------------------------
function replaceOrAppend(arr, id, items) {
  const idx = arr.findIndex((s) => s.id === id);
  if (idx >= 0) arr.splice(idx, 1, ...items);
  else arr.push(...items);
}

// ------------------------------------------------------------
// INJECT PANEL ASSETS (Google/OneDrive)
// ------------------------------------------------------------

async function injectPanelAssets(expanded) {
  for (const slide of expanded) {
    if (slide.type !== "mux" || !slide.panels) continue;

    for (const panel of slide.panels) {
      for (const sid of panel.slides || []) {
        // Find matching expanded slide OR any with parentId = sid
        const ref = expanded.find(
          (s) => s.id === sid || s.parentId === sid
        );
        if (!ref) continue;

        // Google
        if (ref.type === "google-drive" && !ref.images) {
          try {
            const items = await listGoogleImages({
              folderId: ref.folderId,
              order: ref.order,
            });
            ref.images = items;
          } catch (err) {
            console.error(
              `❌ Google MUX inject error for ${sid}: ${err.message}`
            );
          }
        }

        // OneDrive
        if (ref.type === "one-drive" && !ref.images) {
          try {
            const items = await listOneDriveImages({
              folderPath: ref.folderPath || "/Kiosk-Photos",
              order: ref.order,
            });
            ref.images = items;
          } catch (err) {
            console.error(
              `❌ OneDrive MUX inject error for ${sid}: ${err.message}`
            );
          }
        }
      }
    }
  }
}

// ------------------------------------------------------------
// EXPAND — LOCAL FOLDER
// ------------------------------------------------------------

function expandLocalFolder(slide) {
  if (!slide.path) return [];

  try {
    const files = listLocalPhotos(slide.path);

    // Collage → one slide
    if (slide.effect === "collage") {
      return [
        {
          ...slide,
          type: "image-folder",
          images: files.map((file) => ({
            url: `/photos/${file.replace(/^.*[\\/]/, "")}`,
            file,
          })),
        },
      ];
    }

    // Normal: expand into multiple slides
    return files.map((file, idx) => ({
      ...slide,
      id: `${slide.id}__${idx}`,
      parentId: slide.id,
      type: "image",
      file,
    }));
  } catch (err) {
    console.error(`⚠️ Cannot read folder ${slide.path}: ${err.message}`);
    return [];
  }
}

// ------------------------------------------------------------
// EXPAND — GOOGLE DRIVE
// ------------------------------------------------------------

async function expandGoogle(slide) {
  try {
    const items = await listGoogleImages({
      folderId: slide.folderId,
      files: slide.files,
      order: slide.order || "sorted",
    });

    // Collage → single slide
    if (slide.effect === "collage") {
      return [
        {
          ...slide,
          type: "google-drive",
          images: items.map((f) => ({
            url: f.url,
            name: f.name,
            googleId: f.id,
          })),
        },
      ];
    }

    // Multiple slides
    return items.map((file, idx) => ({
      ...slide,
      id: `${slide.id}__${idx}`,
      parentId: slide.id,
      type: "remote-image",
      file: file.url,
      name: file.name,
      googleId: file.id,
    }));
  } catch (err) {
    console.error(`⚠️ Google expand failed: ${err.message}`);
    return [];
  }
}

// ------------------------------------------------------------
// EXPAND — ONEDRIVE
// ------------------------------------------------------------

async function expandOneDrive(slide) {
  try {
    const items = await listOneDriveImages({
      folderPath: slide.folderPath || "/Kiosk-Photos",
      order: slide.order || "sorted",
    });

    if (slide.effect === "collage") {
      return [
        {
          ...slide,
          type: "one-drive",
          images: items.map((f) => ({
            url: f.url,
            name: f.name,
            onedriveId: f.id,
          })),
        },
      ];
    }

    return items.map((file, idx) => ({
      ...slide,
      id: `${slide.id}__${idx}`,
      parentId: slide.id,
      type: "remote-image",
      file: file.url,
      name: file.name,
      onedriveId: file.id,
    }));
  } catch (err) {
    console.error(`⚠️ OneDrive expand failed: ${err.message}`);
    return [];
  }
}

// ------------------------------------------------------------
// EXPAND — MOVIE
// ------------------------------------------------------------

async function expandMovie(slide) {
  try {
    if (!slide.folder) {
      throw new Error(`Movie slide '${slide.id}' is missing folder property`);
    }

    const resolved = await resolveMovieFile(slide.folder);

    return {
      ...slide,
      type: "movie",
      file: resolved,      // absolute or URL path to movie file
      folder: slide.folder
    };

  } catch (err) {
    console.error(`⚠️ Movie expand failed for folder '${slide.folder}': ${err.message}`);
    return slide;  // safe fallback
  }
}

// ------------------------------------------------------------
// EXPAND — HTML
// ------------------------------------------------------------

function expandHtml(slide) {
  return {
    ...slide,
    type: "html",
    url: slide.url,
    duration: slide.duration || 10,
    title: slide.title || "",
  };
}

// ------------------------------------------------------------
// EXPAND — YOUTUBE
// ------------------------------------------------------------

function expandYouTube(slide) {
  return {
    ...slide,
    type: "youtube",
    video_id: slide.video_id,
    duration: slide.duration || 30,
    title: slide.title || "",
  };
}
