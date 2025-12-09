const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

// DOM
const frame = document.getElementById("appFrame");
const loading = document.getElementById("loading");

function log(msg) {
  console.log(msg);
  loading.innerText = "Casthub: " + msg;
}

// -------------------------------
// Handle LOAD messages from sender
// -------------------------------
playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.LOAD,
  loadRequest => {
    const url = loadRequest.media.contentId;

    log("Loading: " + url);

    frame.style.display = "block";
    loading.style.display = "none";

    frame.src = url;

    // Must return modified or original request
    return loadRequest;
  }
);

// -------------------------------
// Custom message channel for CLI
// -------------------------------
context.addCustomMessageListener(
  "urn:x-cast:casthub",
  event => {
    const cmd = event.data;

    if (cmd.type === "reload") {
      log("Reloading iframe...");
      frame.contentWindow.location.reload();
    }

    if (cmd.type === "navigate") {
      log("Navigating to " + cmd.url);
      frame.src = cmd.url;
    }
  }
);

// -------------------------------
// Receiver Options (CRITICAL)
// -------------------------------
const options = new cast.framework.CastReceiverOptions();

options.disableIdleTimeout = true;

options.customNamespaces = {
  "urn:x-cast:casthub": cast.framework.system.MessageType.JSON
};

options.supportedCommands = cast.framework.messages.Command.ALL_BASIC_MEDIA;

// -------------------------------
// Start the receiver
// -------------------------------
log("Receiver started.");
context.start(options);
