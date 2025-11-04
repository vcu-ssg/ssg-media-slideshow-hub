// sonos-test.js
import pkg from "sonos";
const { Sonos, DeviceDiscovery } = pkg;

const SONOS_IP = process.env.SONOS_IP || "192.168.100.135"; // known device IP
const DISCOVERY_TIMEOUT = 8000;

async function tryDirect(ip) {
  try {
    console.log(`🎯 Trying direct connection to ${ip}`);
    const sonos = new Sonos(ip);
    const name = await sonos.getName();
    console.log(`✅ Connected to: ${name}`);

    const track = await sonos.currentTrack().catch(() => ({}));
    console.log(`🎵 Now playing: ${track.title || "(nothing playing)"}`);

    // Try to fetch group info (may not work on older Sonos)
    const groups = await sonos.getAllGroups().catch(() => []);
    if (groups.length) {
      console.log("🧩 Groups:");
      for (const g of groups) {
        console.log(
          `   • ${g.Name || "Unknown"}: ${g.Coordinator || "?"} → [${g.ZoneGroupMember?.length || 0} members]`
        );
      }
    }
    return sonos;
  } catch (err) {
    console.error(`⚠️ Direct connection failed: ${err.message}`);
    return null;
  }
}

async function discoverDevices() {
  return new Promise((resolve, reject) => {
    const found = [];
    console.log("🔍 Starting Sonos network discovery…");

    try {
      const discovery = new DeviceDiscovery();
      discovery.on("DeviceAvailable", async (device) => {
        try {
          const name = await device.getName();
          console.log(`   🎧 Found: ${name} (${device.host})`);
          found.push({ name, host: device.host });
        } catch (e) {
          console.warn(`   ⚠️ Could not read device name for ${device.host}`);
        }
      });

      setTimeout(() => {
        discovery.destroy?.();
        if (found.length === 0) {
          reject(new Error("No Sonos devices discovered"));
        } else {
          resolve(found);
        }
      }, DISCOVERY_TIMEOUT);
    } catch (err) {
      reject(err);
    }
  });
}

(async function main() {
  const direct = await tryDirect(SONOS_IP);
  if (!direct) {
    try {
      const devices = await discoverDevices();
      console.log("\n✅ Discovery complete:");
      devices.forEach((d) => console.log(` • ${d.name} at ${d.host}`));
    } catch (err) {
      console.error(`❌ Discovery failed: ${err.message}`);
    }
  }
})();
