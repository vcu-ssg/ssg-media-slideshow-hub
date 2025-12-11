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
  // NEW: Resolve MUX Panels — embed resolvedSlides[] inside slide
  // ------------------------------------------------------------

  async function resolveMuxPanels(slide) {
    if (!slide.panels) return slide;

    const resolvedPanels = [];

    for (const panel of slide.panels) {
      const resolved = [];

      for (const sid of panel.slides || []) {
        const raw = findMaster(sid);
        if (!raw) continue;

        let child = normalizeSlide(raw);
        child = applyClientOverrides(child, clientCfg);

        switch (child.type) {
          case "image":
          case "remote-image":
          case "html":
          case "youtube":
          case "pause":
          case "multi-frame":
            resolved.push(child);
            break;

          case "folder":
            resolved.push(...expandLocalFolder(child));
            break;

          case "google":
          case "google-drive":
            resolved.push(...(await expandGoogle(child)));
            break;

          case "onedrive":
          case "one-drive":
            resolved.push(...(await expandOneDrive(child)));
            break;

          case "movie":
            resolved.push(await expandMovie(child));
            break;

          default:
            resolved.push(child);
        }
      }

      resolvedPanels.push({
        ...panel,
        resolvedSlides: resolved,
      });
    }

    return {
      ...slide,
      panels: resolvedPanels,
    };
  }

  // ------------------------------------------------------------
  // Add slide (single instance)
  // ------------------------------------------------------------

  const addSlideOnce = async (slideId) => {
    if (seen.has(slideId)) return;
    seen.add(slideId);

    const raw = findMaster(slideId);
    if (!raw) return;

    let slide = normalizeSlide(raw);
    slide = applyClientOverrides(slide, clientCfg);

    const type = (slide.type || "").toLowerCase();

    switch (type) {
      // MULTI-FRAME
      case "multi-frame":
        expanded.push(slide);
        return;

      // SIMPLE IMAGES
      case "image":
      case "remote-image":
        expanded.push(slide);
        return;

      // HTML
      case "html":
        expanded.push(expandHtml(slide));
        return;

      // YOUTUBE
      case "youtube":
        expanded.push(expandYouTube(slide));
        return;

      // LOCAL FOLDER
      case "folder": {
        const list = expandLocalFolder(slide);
        replaceOrAppend(expanded, slide.id, list);
        return;
      }

      // GOOGLE DRIVE
      case "google":
      case "google-drive": {
        const list = await expandGoogle(slide);
        replaceOrAppend(expanded, slide.id, list);
        return;
      }

      // ONEDRIVE
      case "onedrive":
      case "one-drive": {
        const list = await expandOneDrive(slide);
        replaceOrAppend(expanded, slide.id, list);
        return;
      }

      // MOVIE
      case "movie": {
        const m = await expandMovie(slide);
        expanded.push(m);
        return;
      }

      // MUX
      case "mux": {
        const resolved = await resolveMuxPanels(slide);
        expanded.push(resolved);
        return;
      }

      // PAUSE
      case "pause":
        expanded.push({
          id: slide.id,
          type: "pause",
          duration: slide.duration || 1,
        });
        return;

      default:
        console.warn(`⚠️ Unknown slide type '${slide.type}'`);
        expanded.push(slide);
        return;
    }
  };

  // ------------------------------------------------------------
  // Add slide (instance mode, duplicates allowed)
  // ------------------------------------------------------------

  async function addSlideInstance(slideId) {
    const raw = findMaster(slideId);
    if (!raw) return;

    let slide = normalizeSlide(raw);
    slide = applyClientOverrides(slide, clientCfg);

    const type = (slide.type || "").toLowerCase();

    switch (type) {
      case "movie": {
        const m = await expandMovie(slide);
        expanded.push(m);
        return;
      }

      case "pause":
        expanded.push({
          id: slide.id,
          type: "pause",
          duration: slide.duration || 1,
        });
        return;

      case "html":
        expanded.push(expandHtml(slide));
        return;

      case "youtube":
        expanded.push(expandYouTube(slide));
        return;

      case "multi-frame":
      case "image":
      case "remote-image":
        expanded.push({ ...slide });
        return;

      case "folder": {
        const list = expandLocalFolder(slide);
        replaceOrAppend(expanded, slide.id, list);
        return;
      }

      case "google":
      case "google-drive": {
        const list = await expandGoogle(slide);
        replaceOrAppend(expanded, slide.id, list);
        return;
      }

      case "onedrive":
      case "one-drive": {
        const list = await expandOneDrive(slide);
        replaceOrAppend(expanded, slide.id, list);
        return;
      }

      case "mux": {
        const resolved = await resolveMuxPanels(slide);
        expanded.push(resolved);
        return;
      }

      default:
        expanded.push(slide);
        return;
    }
  }

  // Expand entry slides
  for (const id of entryIds) {
    await addSlideInstance(id);
  }

  // Inject Google / OneDrive images into MUX (kept for backwards compatibility)
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
// INJECT PANEL ASSETS (legacy MUX injection - retained)
// ------------------------------------------------------------

async function injectPanelAssets(expanded) {
  for (const slide of expanded) {
    if (slide.type !== "mux" || !slide.panels) continue;

    for (const panel of slide.panels) {
      for (const sid of panel.slides || []) {
        const ref = expanded.find(
          (s) => s.id === sid || s.parentId === sid
        );
        if (!ref) continue;

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
      file: resolved,
      folder: slide.folder,
    };
  } catch (err) {
    console.error(
      `⚠️ Movie expand failed for folder '${slide.folder}': ${err.message}`
    );
    return slide;
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
