// src/core/discovery/chromecast-mdns.js
import mdns from "multicast-dns";

/**
 * Normalize hostnames so `.local` and `.home` map to the same key.
 */
function normalizeHostname(name) {
  if (!name) return null;

  return name
    .trim()
    .toLowerCase()
    .replace(/\.local$/, "")
    .replace(/\.home$/, "")
    .replace(/\.$/, ""); // strip trailing dot
}

/**
 * Classify Chromecast / Google TV based on md (model) TXT field.
 */
function classifyDevice(txt) {
  const md = txt.md?.toLowerCase() || "";

  if (md.includes("google tv streamer")) return "google_tv";
  if (md.includes("chromecast ultra")) return "chromecast_ultra";
  if (md.includes("chromecast")) return "chromecast";
  if (md.includes("home") || md.includes("nest")) return "google_speaker";
  if (md.includes("audio")) return "audio_only";

  return "unknown";
}

/**
 * Production-grade Chromecast + Google TV mDNS discovery.
 */
export function discoverChromecastsMDNS(timeout = 2000) {
  return new Promise((resolve) => {
    const md = mdns();

    // Cache keyed by normalized hostname
    const services = new Map();

    const ensure = (hostnameRaw) => {
      const hostname = normalizeHostname(hostnameRaw);
      if (!hostname) return null;

      if (!services.has(hostname)) {
        services.set(hostname, {
          hostname,
          addresses: new Set(),
          port: 8009, // Cast v2 default (Google TV always uses 8009)
          txt: {},
          name: null,
          model: null,
          id: null,
        });
      }
      return services.get(hostname);
    };

    /**
     * Process a single mDNS record (answers/additionals/authorities)
     */
    function handleRecord(record, packet) {
      if (!record) return;

      //
      // 1. PTR → always ensure entry and request SRV + A/AAAA
      //
      if (record.type === "PTR" && record.name === "_googlecast._tcp.local") {
        const hostname = normalizeHostname(record.data);
        const svc = ensure(hostname);

        if (svc) {
          md.query([{ name: `${hostname}.local`, type: "SRV" }]);
          md.query([{ name: `${hostname}.local`, type: "A" }]);
          md.query([{ name: `${hostname}.local`, type: "AAAA" }]);
        }
      }

      //
      // 2. SRV → real hostname + port
      //
      if (record.type === "SRV") {
        const target = normalizeHostname(record.data.target);
        const svc = ensure(target);
        if (svc) {
          svc.port = record.data.port || 8009;

          const fqdn = `${target}.local`;
          md.query([{ name: fqdn, type: "A" }]);
          md.query([{ name: fqdn, type: "AAAA" }]);
        }
      }

      //
      // 3. TXT → metadata, correlated using SRV/PTR in packet
      //
      if (record.type === "TXT") {
        let hostname = null;

        // Look for SRV in same packet
        let srv = packet.answers.find((a) => a.type === "SRV");
        if (!srv) srv = packet.additionals.find((a) => a.type === "SRV");

        if (srv) {
          hostname = normalizeHostname(srv.data.target);
        } else if (record.name.endsWith(".local")) {
          hostname = normalizeHostname(record.name);
        }

        if (!hostname) return;

        const svc = ensure(hostname);
        if (!svc) return;

        const entries = Array.isArray(record.data) ? record.data : [record.data];
        for (const buf of entries) {
          const str = buf.toString();
          if (str.includes("=")) {
            const [k, v] = str.split("=");
            svc.txt[k] = v;
          }
        }

        svc.name = svc.txt.fn || svc.name;
        svc.model = svc.txt.md || svc.model;
        svc.id = svc.txt.id || svc.id;

        md.query([{ name: `${hostname}.local`, type: "A" }]);
      }

      //
      // 4. A / AAAA → IP resolution
      //
      if (record.type === "A" || record.type === "AAAA") {
        const hostname = normalizeHostname(record.name);
        const svc = ensure(hostname);
        if (svc) svc.addresses.add(record.data);
      }
    }

    //
    // Main packet handler
    //
    md.on("response", (packet) => {
      const records = [
        ...packet.answers,
        ...packet.additionals,
        ...packet.authorities,
      ];

      records.forEach((rec) => handleRecord(rec, packet));
    });

    //
    // Initial query
    //
    md.query([{ name: "_googlecast._tcp.local", type: "PTR" }]);

    //
    // Finish after timeout
    //
    setTimeout(() => {
      md.destroy();

      const devices = [];

      for (const svc of services.values()) {
        if (svc.addresses.size === 0) continue;

        devices.push({
          host: [...svc.addresses][0],
          port: svc.port,
          name: svc.name || "Unknown",
          model: svc.model || "Unknown",
          type: classifyDevice(svc.txt),
          id: svc.id || null,
          rawTXT: svc.txt,
        });
      }

      resolve(devices);
    }, timeout);
  });
}
