#!/usr/bin/env bash
set -e

NFS_SERVER="192.168.100.10"
NFS_EXPORT="/dockermedia"
MOUNT_POINT="/mnt/dockermedia"
FSTAB_LINE="$NFS_SERVER:$NFS_EXPORT  $MOUNT_POINT  nfs  defaults,_netdev,noatime,nolock,bg  0  0"

echo "📦 Installing NFS client utilities..."
sudo apt update -y
sudo apt install -y nfs-common

echo "📁 Creating mount point..."
sudo mkdir -p "$MOUNT_POINT"

echo "📝 Checking /etc/fstab for existing entry..."
if grep -q "$NFS_SERVER:$NFS_EXPORT" /etc/fstab; then
    echo "✔ Entry already exists in /etc/fstab"
else
    echo "➕ Adding NFS mount to /etc/fstab..."
    echo "$FSTAB_LINE" | sudo tee -a /etc/fstab > /dev/null
fi

echo "🔧 Attempting to mount all filesystems..."
sudo mount -a || true

echo "🎉 Done."
echo "If the mount failed during mount -a, be sure your ~/.wslconfig contains:"
echo "[automount]"
echo "enabled=true"
echo "mountFsTab=true"
echo
echo "Then run:  wsl --shutdown"
