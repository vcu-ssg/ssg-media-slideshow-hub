#!/usr/bin/env node
import { Command } from "commander";
import inquirer from "inquirer";
import { discoverChromecasts } from "../../core/discovery/chromecast-discovery.js";
import { launchKioskOnChromecast } from "./cast-launcher.js";

const program = new Command();
const DEFAULT_KIOSK_URL = "http://dovetail.local:8080"; // customize per your hub

program
  .name("ssg-chromecast")
  .description("Chromecast Manager for SSG Media Slideshow Hub")
  .version("0.1.0");

//
// ------------------------------------------------------------
// DISCOVER COMMAND
// ------------------------------------------------------------
program
  .command("discover")
  .description("Discover Chromecast devices on the LAN")
  .action(async () => {
    const devices = await discoverChromecasts();

    if (!devices.length) {
      console.log("No Chromecasts found.");
      return;
    }

    console.log("\nDiscovered Chromecasts:\n");
    devices.forEach((d, i) => {
      console.log(`${i + 1}. ${d.name} (${d.host})  type=${d.type}  id=${d.id}`);
    });
    console.log("");
  });

//
// ------------------------------------------------------------
// LAUNCH COMMAND
// ------------------------------------------------------------
program
  .command("launch")
  .description("Launch the kiosk UI on a Chromecast device")
  .option("-u, --url <string>", "Kiosk URL", DEFAULT_KIOSK_URL)
  .action(async (opts) => {
    const devices = await discoverChromecasts();

    if (!devices.length) {
      console.log("No Chromecasts found.");
      return;
    }

    const { selected } = await inquirer.prompt([
      {
        type: "list",
        name: "selected",
        message: "Select a Chromecast:",
        choices: devices.map(d => ({
          name: `${d.name} (${d.host})`,
          value: d,
        }))
      }
    ]);

    console.log(`Launching kiosk on ${selected.name} (${selected.host})...`);

    try {
      await launchKioskOnChromecast(selected, opts.url);
      console.log("✔ Kiosk loaded successfully.");
    } catch (err) {
      console.error("❌ Error loading kiosk:", err.message);
    }
  });

program.parse(process.argv);
