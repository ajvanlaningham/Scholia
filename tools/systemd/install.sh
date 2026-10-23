#!/usr/bin/env bash
# Installs the weekly refresh as a systemd user timer. Rerun after editing the units.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
target="$HOME/.config/systemd/user"
mkdir -p "$target"
cp "$here/scholia-refresh.service" "$here/scholia-refresh.timer" "$target/"
systemctl --user daemon-reload
systemctl --user enable --now scholia-refresh.timer
systemctl --user list-timers scholia-refresh.timer --no-pager
