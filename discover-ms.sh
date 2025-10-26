#!/usr/bin/env bash
# ------------------------------------------------------------
# discover_onedrive_ids.sh
#   Helper script to discover SharePoint SiteID, DriveID,
#   and verify a photo folder for OneDrive / SharePoint.
# ------------------------------------------------------------
set -euo pipefail

# ------------------------------------------------------------
# 🔧 Config — fill these in gradually
# ------------------------------------------------------------
TENANT_ID="${ONEDRIVE_TENANT_ID:-}"
CLIENT_ID="${ONEDRIVE_CLIENT_ID:-}"
CLIENT_SECRET="${ONEDRIVE_CLIENT_SECRET:-}"
SEARCH_TERM="${SEARCH_TERM:-lowkeylabs}"
SITE_ID="${ONEDRIVE_SITE_ID:-}"
DRIVE_ID="${ONEDRIVE_DRIVE_ID:-}"
FOLDER_PATH="${FOLDER_PATH:-/Kiosk-Photos}"

# ------------------------------------------------------------
# 🧩 Prerequisites
# ------------------------------------------------------------
if ! command -v jq >/dev/null; then
  echo "❌ Missing 'jq'. Please install it (apt install jq, brew install jq, etc.)" >&2
  exit 1
fi

if [[ -z "$TENANT_ID" || -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]]; then
  echo "⚠️  Please set TENANT_ID, CLIENT_ID, and CLIENT_SECRET at the top of this script."
  exit 1
fi

# ------------------------------------------------------------
# 🔐 Get access token
# ------------------------------------------------------------
echo "🔐 Requesting access token..."
TOKEN=$(curl -s -X POST "https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=${CLIENT_ID}" \
  -d "scope=https://graph.microsoft.com/.default" \
  -d "client_secret=${CLIENT_SECRET}" \
  -d "grant_type=client_credentials" | jq -r '.access_token')

if [[ "$TOKEN" == "null" || -z "$TOKEN" ]]; then
  echo "❌ Failed to obtain token. Check your tenant/app credentials." >&2
  exit 1
fi
echo "✅ Got access token (starts with ${TOKEN:0:16}...)"

# ------------------------------------------------------------
# 🏢 Verify token’s organization
# ------------------------------------------------------------
echo "🏢 Checking organization domain..."
ORG_JSON=$(curl -s -H "Authorization: Bearer $TOKEN" https://graph.microsoft.com/v1.0/organization)
DOMAIN=$(echo "$ORG_JSON" | jq -r '.value[0].verifiedDomains[0].name // empty')

if [[ -z "$DOMAIN" ]]; then
  echo "❌ Could not determine organization domain. Raw response:" >&2
  echo "$ORG_JSON" | jq
  exit 1
fi
echo "✅ Token belongs to organization: $DOMAIN"

# ------------------------------------------------------------
# 🔍 Check access to root SharePoint site
# ------------------------------------------------------------
echo "🔎 Checking root SharePoint site access..."
RESP=$(curl -s -H "Authorization: Bearer $TOKEN" "https://graph.microsoft.com/v1.0/sites/root")

SITE_ID_EXTRACT=$(echo "$RESP" | jq -r '.id // empty')
SITE_URL=$(echo "$RESP" | jq -r '.webUrl // empty')
DISPLAY_NAME=$(echo "$RESP" | jq -r '.displayName // empty')

if [[ -n "$SITE_ID_EXTRACT" && "$SITE_URL" == *"sharepoint.com"* ]]; then
  echo "✅ SharePoint root site detected:"
  echo "   → Site ID: $SITE_ID_EXTRACT"
  echo "   → URL: $SITE_URL"
  echo "   → Name: ${DISPLAY_NAME:-<no name>}"
  echo
  SITE_ID="$SITE_ID_EXTRACT"
else
  echo "❌ Unable to read /sites/root — possible causes:"
  echo "   • Missing Sites.Read.All permission"
  echo "   • Token belongs to personal Microsoft account"
  echo "   • Tenant mismatch between Azure App and SharePoint tenant"
  echo "Raw response:"; echo "$RESP" | jq .
  exit 1
fi

echo "✅ Confirmed SharePoint root site:"
echo "   → Display name: ${DISPLAY_NAME:-<none>}"
echo "   → URL: $SITE_URL"
echo "   → ID : $SITE_ID_EXTRACT"
echo

# ------------------------------------------------------------
# 📂 List Drives for this site
# ------------------------------------------------------------
echo "📂 Listing document libraries (drives) for site..."
DRIVES_JSON=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/sites/${SITE_ID}/drives")

if [[ $(echo "$DRIVES_JSON" | jq -r '.value | length') -eq 0 ]]; then
  echo "❌ No drives found or insufficient permissions. Raw response:"
  echo "$DRIVES_JSON" | jq .
  exit 1
fi

echo "✅ Found the following drives:"
echo "$DRIVES_JSON" | jq '.value[] | {name, id, driveType}'
echo

# ------------------------------------------------------------
# 🧭 List top-level folders for reference
# ------------------------------------------------------------
echo "📁 Enumerating top-level folders in drive..."
TOP=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/sites/${SITE_ID}/drives/${DRIVE_ID}/root/children")

if [[ "$(echo "$TOP" | jq -r '.value | length')" == "0" ]]; then
  echo "❌ Could not list top-level folders. Raw response:"; echo "$TOP" | jq .
  exit 1
fi

echo "$TOP" | jq -r '.value[] | select(.folder) | .name' | awk '{print "   • " $0}'
echo
echo "📌 Use one of the names above in FOLDER_PATH (e.g. /Shared Documents/Photos)"
echo

# ------------------------------------------------------------
# 🖼️  Verify folder contents
# ------------------------------------------------------------
echo "🖼️  Checking folder '${FOLDER_PATH}' in drive..."

if [[ "$FOLDER_PATH" == "/" ]]; then
  API_URL="https://graph.microsoft.com/v1.0/sites/${SITE_ID}/drives/${DRIVE_ID}/root/children"
else
  API_URL="https://graph.microsoft.com/v1.0/sites/${SITE_ID}/drives/${DRIVE_ID}/root:${FOLDER_PATH}:/children"
fi

RESP=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $TOKEN" "$API_URL")

BODY=$(echo "$RESP" | head -n -1)
CODE=$(echo "$RESP" | tail -n 1)

if [[ "$CODE" != "200" ]]; then
  echo "❌ Graph API error ($CODE). Response:" >&2
  echo "$BODY" | jq .
  echo "⚠️  Tip: try adjusting FOLDER_PATH or verify that the folder exists above."
  exit 1
fi

COUNT=$(echo "$BODY" | jq '.value | length')
echo "✅ Found $COUNT items:"
echo "$BODY" | jq '.value[] | {name, mimeType:.file.mimeType}' | head -n 20

echo
echo "🎯 If you see image/jpeg or image/png entries above, your OneDrive folder is ready!"
