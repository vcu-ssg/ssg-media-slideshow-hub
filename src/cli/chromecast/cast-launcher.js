// src/cli/chromecast/cast-launcher.js
import ChromecastAPI from "chromecast-api";

export function launchKioskOnChromecast(device, kioskUrl) {
  return new Promise((resolve, reject) => {
    const browser = new ChromecastAPI.Browser();
    browser.devices.push({
      name: device.name,
      host: device.host,
      port: device.port,
    });

    const castDevice = browser.devices.find(d => d.host === device.host);
    if (!castDevice) return reject(new Error("Device not found"));

    castDevice.play(kioskUrl, (err) =>
      err ? reject(err) : resolve(true)
    );
  });
}
