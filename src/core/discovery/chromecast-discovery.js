// src/core/discovery/chromecast-discovery.js
import { discoverChromecastsMDNS } from "./chromecast-mdns.js";
import { discoverChromecastsSSDP } from "./chromecast-ssdp.js";

/**
 * Unified Chromecast discovery (MDNS + SSDP)
 */
export async function discoverChromecasts() {
  const [mdns, ssdp] = await Promise.all([
    discoverChromecastsMDNS(),
    discoverChromecastsSSDP()
  ]);

  const combined = [...mdns, ...ssdp];

  // Dedupe by host
  const map = new Map();
  combined.forEach(dev => {
    if (!map.has(dev.host)) map.set(dev.host, dev);
  });

  return [...map.values()];
}
