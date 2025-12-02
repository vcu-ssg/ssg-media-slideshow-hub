// onedriveimages.js — Drop-in OneDrive/SharePoint photo loader
import fs from "fs";
import dotenv from "dotenv";

// Load environment from ~/.env or ENV_PATH
dotenv.config({ path: process.env.ENV_PATH || "/home/john/.env" });

const TENANT_ID = process.env.ONEDRIVE_TENANT_ID;
const CLIENT_ID = process.env.ONEDRIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.ONEDRIVE_CLIENT_SECRET;
const SITE_ID = process.env.ONEDRIVE_SITE_ID;
const DRIVE_ID = process.env.ONEDRIVE_DRIVE_ID;

// Token cache (so we don't fetch on every request)
let tokenCache = { access_token: null, expires_at: 0 };

/**
 * Obtain a valid Microsoft Graph access token.
 */
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.access_token && now < tokenCache.expires_at - 60)
    return tokenCache.access_token;

  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }),
    }
  );

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Token request failed: ${res.status} ${
        data.error_description || JSON.stringify(data)
      }`
    );
  }

  tokenCache.access_token = data.access_token;
  tokenCache.expires_at = now + (data.expires_in || 3600);
  return data.access_token;
}

/**
 * List images in a OneDrive/SharePoint folder.
 * @param {object} opts - { folderId, folderPath, order }
 * - folderPath: e.g. "/Kiosk-Photos"
 * - order: "random" | "sorted"
 */
export async function listOneDriveImages({
  folderPath = "/Kiosk-Photos",
  order = "sorted",
} = {}) {
  const token = await getAccessToken();

  const apiUrl =
    folderPath === "/"
      ? `https://graph.microsoft.com/v1.0/sites/${SITE_ID}/drives/${DRIVE_ID}/root/children`
      : `https://graph.microsoft.com/v1.0/sites/${SITE_ID}/drives/${DRIVE_ID}/root:${folderPath}:/children`;

  const res = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // Capture raw text for diagnostics if not JSON
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Graph API error ${res.status}: ${text.slice(0, 200)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
  }

  const items = (data.value || []).filter(
    (f) => f.file && f.file.mimeType?.startsWith("image/")
  );

  if (items.length === 0) {
    console.warn(
      `⚠️  No images found in OneDrive folder '${folderPath}'. Check path or permissions.`
    );
  }

  // Sort or shuffle
  if (order === "random") items.sort(() => 0.5 - Math.random());
  else items.sort((a, b) => a.name.localeCompare(b.name));

  // Convert to consistent structure
  return items.map((f) => ({
    id: f.id,
    name: f.name,
    url: f["@microsoft.graph.downloadUrl"], // direct file URL
  }));
}

/**
 * CLI test (optional)
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      const imgs = await listOneDriveImages({
        folderPath: process.env.ONEDRIVE_FOLDER_PATH || "/Kiosk-Photos",
        order: "random",
      });
      console.log(`✅ OneDrive returned ${imgs.length} images`);
      if (imgs.length) console.log("Example:", imgs[0]);
    } catch (err) {
      console.error("❌ Error:", err.message);
    }
  })();
}
