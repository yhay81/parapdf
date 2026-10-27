#!/usr/bin/env bash
# Installs Playwright's browser $1 and the system packages it needs on a CI
# runner, giving up on an attempt after four minutes; it usually takes 40 s.
#
# Ubuntu's Azure mirror sometimes served a runner at 20 to 50 kB/s, and the
# WebKit job's packages (fonts, ffmpeg's libraries) then took longer than the
# job's 30 minutes (run 40508405695, attempts 1 and 3). Later attempts take
# the packages from archive.ubuntu.com instead; apt keeps what an earlier
# attempt downloaded.
#
# Playwright runs apt-get through sudo, as root, where a timeout of the
# runner's user cannot reach it: a slow first attempt then ran until the
# step's limit (run 40545670466). The timeout runs as root instead, and
# kills the attempt's whole process group, apt-get included.
set -uo pipefail

browser=$1
for attempt in 1 2 3; do
  if [ "$attempt" -gt 1 ]; then
    sudo sed -i 's|azure\.archive\.ubuntu\.com|archive.ubuntu.com|' /etc/apt/apt-mirrors.txt
    # A stopped attempt may have interrupted dpkg.
    sudo dpkg --configure -a
  fi
  limit=4m; [ "$attempt" -eq 1 ] && limit=15s  # TEMPORARY test of the kill
  if sudo --preserve-env timeout --kill-after=10s "$limit" \
    sudo --preserve-env -u "$USER" env "PATH=$PATH" \
    pnpm --filter @parapdf/bench exec playwright install --with-deps "$browser"; then
    exit 0
  fi
  echo "::warning::Installing $browser failed or took longer than 4 minutes (attempt $attempt)"
done
exit 1
