import { Client } from "castv2-client";
import { DefaultMediaReceiver } from "castv2-client";

export function launchURL(host, url, appId) {
  return new Promise((resolve, reject) => {
    const client = new Client();

    client.connect(host, () => {
      console.log(`Connected to ${host}`);

      client.launch(DefaultMediaReceiver, { appId }, (err, player) => {
        if (err) {
          client.close();
          return reject(err);
        }

        const media = {
          contentId: url,
          contentType: "text/html",
          streamType: "BUFFERED"
        };

        const options = { autoplay: true };

        player.load(media, options, (err, status) => {
          client.close();

          if (err) return reject(err);
          resolve(status);
        });
      });
    });

    client.on("error", err => {
      console.error("Cast error:", err);
      try { client.close(); } catch {}
      reject(err);
    });
  });
}
