// src/core/discovery/chromecast-ssdp.js
import pkg from "node-ssdp";
import fetch from "node-fetch";

const { Client } = pkg;

/**
 * SSDP fallback for Chromecast discovery
 */
export function discoverChromecastsSSDP(timeout = 2000) {
  const results = [];
  const ssdp = new Client();

  return new Promise((resolve) => {
    ssdp.on("response", async (headers, _code, rinfo) => {
      if (!headers.LOCATION) return;

      try {
        const xml = await fetch(headers.LOCATION).then(r => r.text());

        // Only process Google Cast devices
        if (!xml.includes("Google Chromecast") &&
            !xml.includes("Eureka Dongle")) return;

        results.push({
          source: "ssdp",
          name: extract(xml, "friendlyName"),
          model: extract(xml, "modelName"),
          id: extract(xml, "UDN")?.replace("uuid:", ""),
          host: rinfo.address,
          port: 8009 // Cast port
        });

      } catch (_) {}
    });

    // SSDP search for Google DIAL service
    ssdp.search("urn:dial-multiscreen-org:service:dial:1");

    setTimeout(() => resolve(results), timeout);
  });
}

function extract(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
  return match ? match[1] : null;
}
