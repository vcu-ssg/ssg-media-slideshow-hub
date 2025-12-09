#!/usr/bin/env node
import { Command } from "commander";
import discoverCmd from "./commands/discover.js";
import launchCmd from "./commands/launch.js";

const program = new Command();

program
  .name("casthub")
  .description("CLI tools for discovering and controlling Chromecast / Google TV devices")
  .version("1.0.0");

// ---- Commands ----
program.addCommand(discoverCmd);
program.addCommand(launchCmd);

// -------------------
program.parse(process.argv);
