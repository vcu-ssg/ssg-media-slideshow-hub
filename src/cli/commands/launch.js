// src/cli/commands/launch.js
import { Command } from "commander";
import { discoverChromecastsMDNS } from "../../core/discovery/chromecast-mdns.js";

import castv2 from "castv2";
const { Client } = castv2;

async function launchToCastDevice(host, appId, url) {
  return new Promise((resolve, reject) => {
    const client = new Client();

    client.connect(host, () => {
      console.log(`Connected to ${host}`);
      console.log(`Launching custom appId: ${appId}`);

      const receiver = client.createChannel(
        "receiver-0",
        "urn:x-cast:com.google.cast.receiver",
        "JSON"
      );

      // --- LAUNCH ---
      receiver.send(JSON.stringify({
        type: "LAUNCH",
        appId,
        requestId: 1
      }));

      receiver.on("message", (data) => {
        if (data.type !== "RECEIVER_STATUS") return;

        const app = data.status?.applications?.[0];
        if (!app) return;

        console.log(`Receiver app running: ${app.displayName}`);

        const transportId = app.transportId;

        // Open custom namespace channel
        const custom = client.createChannel(
          transportId,
          "urn:x-cast:casthub",
          "JSON"
        );

        console.log("Sending navigate command:", url);

        custom.send(JSON.stringify({
          type: "navigate",
          url
        }));

        setTimeout(() => {
          client.close();
          resolve({ ok: true });
        }, 500);
      });
    });

    client.on("error", (err) => {
      console.error("Cast error:", err);
      try { client.close(); } catch {}
      reject(err);
    });
  });
}

// -----------------------------------------------------------
// Commander Command
// -----------------------------------------------------------
const launch = new Command("launch")
  .description("Launch a URL using your custom Cast Web Receiver app")
  .argument("<device>", "Device name or partial name")
  .requiredOption("--url <url>", "URL to load")
  .requiredOption("--appid <appid>", "Cast Web Receiver App ID")
  .action(async (deviceName, opts) => {
    const { url, appid } = opts;

    console.log("\nDiscovering devices...\n");
    const devices = await discoverChromecastsMDNS();

    const match = devices.find(d =>
      d.name.toLowerCase().includes(deviceName.toLowerCase())
    );

    if (!match) {
      console.log("Device not found:", deviceName);
      return;
    }

    console.log("Found:", match.name, match.host);

    console.log("Launching...");
    await launchToCastDevice(match.host, appid, url);

    console.log("✔ Done.\n");
  });

export default launch;
