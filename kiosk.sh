#!/bin/bash
#exec >/dev/null 2>&1

export DISPLAY=:0
export XAUTHORITY=/home/john/.Xauthority
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/1000/bus"

# sudo -u john unclutter -idle 0  &

chromium \
  --kiosk \
  --password-store=basic \
  --disable-gcm-registration \
  --start-fullscreen \
  --app=http://localhost:3000/?client-host=scrollsaw \
  --disable-restore-session-state \
  --autoplay-policy=no-user-gesture-required \  
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --fast \
  --fast-start \
  --incognito \
  --disable-features=UseSkiaRenderer \
  --disable-gpu-rasterization \
  --disable-zero-copy \
  --disable-crash-reporter \
  --enable-features=AudioServiceOutOfProcess \
  --alsa-output-device=default \
  &
