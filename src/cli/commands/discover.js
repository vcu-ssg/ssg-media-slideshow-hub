import { Command } from "commander";
import { discoverChromecastsMDNS } from "../../core/discovery/chromecast-mdns.js";

const discover = new Command("discover")
  .description("Discover Chromecast and Google TV devices on the LAN")
  .action(async () => {
    console.log("Scanning for cast-enabled devices...\n");

    const devices = await discoverChromecastsMDNS(2000);

    if (!devices.length) {
      console.log("No cast devices found.\n");
      return;
    }

    console.log("Discovered Devices:\n");

    devices.forEach((d, i) => {
      console.log(
        `${i + 1}. ${d.name} (${d.host})  type=${d.type}  id=${d.id}`
      );
    });

    console.log("");
  });

export default discover;
