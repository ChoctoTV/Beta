#!/usr/bin/env bash
# killswitch.sh — ChoctoTV nuclear process killer
# Kills every ChoctoTV-related process regardless of which build or folder it came from

echo ""
echo "━━━  ChoctoTV Kill Switch  ━━━"
echo ""

kill_procs() {
  local name="$1"
  shift
  local pids
  pids=$(pgrep -f "$1" 2>/dev/null || true)
  for p in $pids; do
    kill -9 "$p" 2>/dev/null && echo "  ✓ killed $name (pid $p)" || true
  done
}

# Node processes
kill_procs "app.js"          "node.*app\.js"
kill_procs "companion.js"    "node.*companion\.js"
kill_procs "stream.js"       "node.*stream\.js"
kill_procs "streamCapture"   "node.*streamCapture\.js"
kill_procs "balanceApi"      "node.*balanceApi\.js"
kill_procs "itemsApi"        "node.*itemsApi\.js"
kill_procs "musicPlayer"     "node.*musicPlayer\.js"
kill_procs "music.js"        "node.*music\.js"

# Stream pipeline
kill_procs "ffmpeg"          "ffmpeg.*rtmp"
kill_procs "ffmpeg (any)"    "ffmpeg"
kill_procs "Xvfb"            "Xvfb"
kill_procs "xcompmgr"        "xcompmgr"
kill_procs "unclutter"       "unclutter"
kill_procs "chromium"        "chromium"
kill_procs "chrome"          "google-chrome"
kill_procs "ffplay"          "ffplay"

# PM2 (cloud)
pm2 kill 2>/dev/null && echo "  ✓ pm2 stopped" || true

# Clean up Xvfb lock files (stale locks cause Xvfb to fail on next start)
for locknum in 99 98 0 1 2; do
  rm -f "/tmp/.X${locknum}-lock" "/tmp/.X11-unix/X${locknum}" 2>/dev/null && echo "  ✓ removed Xvfb :${locknum} lock" || true
done

# Clean up PID files from any build
find /home -name "*.pid" 2>/dev/null | while read f; do rm -f "$f"; echo "  ✓ removed $f"; done
find /tmp -name "choctotv_*" 2>/dev/null | while read f; do rm -f "$f"; echo "  ✓ removed $f"; done
rm -f /tmp/choctotv_music*.json 2>/dev/null || true

echo ""
echo "  Verifying nothing is left..."
sleep 1
remaining=$(pgrep -f "app\.js|companion\.js|stream\.js|streamCapture|balanceApi|itemsApi|musicPlayer|music\.js" 2>/dev/null | wc -l)
ffmpeg_left=$(pgrep -f "ffmpeg" 2>/dev/null | wc -l)
xvfb_left=$(pgrep -f "Xvfb" 2>/dev/null | wc -l)

[ "$remaining" -eq 0 ] && echo "  ✓ No Node processes remain" || echo "  ⚠ $remaining Node process(es) still running"
[ "$ffmpeg_left" -eq 0 ] && echo "  ✓ No FFmpeg processes remain" || echo "  ⚠ $ffmpeg_left FFmpeg process(es) still running"
[ "$xvfb_left" -eq 0 ]   && echo "  ✓ No Xvfb processes remain"   || echo "  ⚠ $xvfb_left Xvfb process(es) still running"

echo ""
echo "  Done. All ChoctoTV services terminated."
echo ""
