// googleimages.js  —  Public CDN–aware version with automatic fallback and warnings
import fs from "fs";
import { google } from "googleapis";
import dotenv from "dotenv";

// Load env (path provided by ENV_PATH or fallback to /home/john/.env)
dotenv.config({ path: process.env.ENV_PATH || "/home/john/.env" });

let driveClient = null;

/**
 * Initialize a Google Drive client from the service-account JSON file.
 * The JSON path is specified in GOOGLE_CREDENTIALS_PATH (in .env).
 */
export async function initGoogleDrive() {
  if (driveClient) return driveClient;

  const credPath = process.env.GOOGLE_CREDENTIALS_PATH;
  if (!credPath || !fs.existsSync(credPath)) {
    console.warn(`⚠️  GOOGLE_CREDENTIALS_PATH not found or unreadable: ${credPath}`);
    return null;
  }

  try {
    const creds = JSON.parse(fs.readFileSync(credPath, "utf8"));
    const scopes = [
      process.env.GOOGLE_API_SCOPES ||
        "https://www.googleapis.com/auth/drive.readonly",
    ];

    const auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes,
    });

    driveClient = google.drive({ version: "v3", auth });
    return driveClient;
  } catch (err) {
    console.error("❌ Failed to initialize Google Drive:", err.message);
    return null;
  }
}

/**
 * Retrieve a list of image URLs from Google Drive.
 *  - `folderId`: ID of a Drive folder
 *  - `files`: explicit list of file IDs (optional)
 *  - `order`: "sorted" | "random"
 */
export async function listGoogleImages({ folderId, files, order = "sorted" }) {
  const drive = await initGoogleDrive();
  if (!drive) return [];

  const logFile =
    process.env.KIOSK_LOG_FILE ||
    "/home/john/projects/ssg-kiosk-photo-player/logs/access.log";

  const appendLog = (msg) => {
    try {
      const ts = new Date().toISOString();
      fs.appendFileSync(logFile, `${ts} | ${msg}\n`);
    } catch {}
  };

  try {
    let items = [];

    // --- Explicit file list ---
    if (Array.isArray(files) && files.length > 0) {
      for (const fid of files) {
        const res = await drive.files.get({
          fileId: fid,
          fields: "id,name,webViewLink,webContentLink,mimeType",
        });
        if (res.data.mimeType?.startsWith("image/")) items.push(res.data);
      }
    }

    // --- Folder listing ---
    else if (folderId) {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
        fields: "files(id,name,webViewLink,webContentLink)",
        pageSize: 200,
      });
      items = res.data.files || [];
    }

    // --- Sort or shuffle ---
    if (order === "random") items.sort(() => 0.5 - Math.random());
    else items.sort((a, b) => a.name.localeCompare(b.name));

    // --- Warn if nothing found ---
    if (items.length === 0) {
      const warn = `⚠️  Google Drive folder '${folderId}' returned 0 images. Possible permission issue — share folder with your service account email or make it public.`;
      console.warn(warn);
      appendLog(warn);
    }

    // --- Generate robust URLs ---
    const results = items.map((f) => {
      // ✅ Fast public CDN form
      const cdnUrl = `https://lh3.googleusercontent.com/d/${f.id}=s1600`;

      // fallback for private/shared folders
      const fallbackUrl =
        f.webContentLink?.replace("export=download", "export=view") ||
        f.webViewLink ||
        cdnUrl;

      return {
        id: f.id,
        name: f.name,
        url: cdnUrl || fallbackUrl,
      };
    });

    appendLog(
      `✅ Google Drive: ${results.length} images loaded from folder ${folderId}`
    );
    return results;
  } catch (err) {
    const msg = `❌ Error listing Google Drive images: ${err.message}`;
    console.error(msg);
    appendLog(msg);
    return [];
  }
}
