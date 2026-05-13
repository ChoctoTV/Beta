#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  ChoctoTV — start.sh
#  Usage:
#    ./start.sh              start everything + interactive command console
#    ./start.sh stop         stop all services
#    ./start.sh restart      stop then start
#    ./start.sh status       service health
#    ./start.sh setup        run first-time setup wizard
#    ./start.sh viewer       open local preview of the stream
#    ./start.sh update       push to GitHub
#    ./start.sh rollback     revert to last good GitHub build
#    ./start.sh deploy       push to Oracle Cloud
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS="$DIR/.pids"
LOGS="$DIR/logs"
mkdir -p "$PIDS" "$LOGS"

GR='\033[0;32m'; YL='\033[0;33m'; RD='\033[0;31m'
CY='\033[0;36m'; WT='\033[1;37m'; DM='\033[2m'; NC='\033[0m'
ok()   { echo -e "${GR}  ✓${NC} $*"; }
info() { echo -e "${CY}  →${NC} $*"; }
warn() { echo -e "${YL}  ⚠${NC} $*"; }
err()  { echo -e "${RD}  ✗${NC} $*"; }
hdr()  { echo -e "\n${WT}$*${NC}"; }

# ── Load .env ──────────────────────────────────────────────────────────────────
load_env() {
  [[ -f "$DIR/.env" ]] && { set -a; source "$DIR/.env"; set +a; } || true
}

# ── Kill a PID file ────────────────────────────────────────────────────────────
kill_pid() {
  local f="$PIDS/$1.pid"
  [[ -f "$f" ]] || return 0
  local pid; pid=$(cat "$f")
  kill "$pid" 2>/dev/null || true
  rm -f "$f"
}

# ── Launch a service ───────────────────────────────────────────────────────────
launch() {
  local name="$1" script="$2" logfile="$3" delay="${4:-1}"
  info "Starting $name..."
  node "$DIR/$script" >> "$LOGS/$logfile" 2>&1 &
  local pid=$!
  echo "$pid" > "$PIDS/$name.pid"
  sleep "$delay"
  if kill -0 "$pid" 2>/dev/null; then
    ok "$name (pid $pid)"
  else
    err "$name failed — check $LOGS/$logfile"
    exit 1
  fi
}

# ── Stop all ───────────────────────────────────────────────────────────────────
stop_all() {
  info "Stopping all services..."
  for svc in app stream music; do kill_pid "$svc"; done
  pkill -f "node $DIR/app.js"    2>/dev/null || true
  pkill -f "node $DIR/stream.js" 2>/dev/null || true
  pkill -f "node $DIR/music.js"  2>/dev/null || true
  sleep 1
  ok "All stopped"
}

# ── Status ─────────────────────────────────────────────────────────────────────
show_status() {
  hdr "  ChoctoTV — Service Status"
  echo ""
  for svc in app stream music; do
    local f="$PIDS/$svc.pid"
    if [[ -f "$f" ]]; then
      local pid; pid=$(cat "$f")
      if kill -0 "$pid" 2>/dev/null; then
        local mem; mem=$(ps -o rss= -p "$pid" 2>/dev/null | awk '{printf "%.1fMB",$1/1024}' || echo "?")
        ok "$svc  ${DM}pid=$pid mem=$mem${NC}"
      else
        err "$svc  ${DM}pid=$pid — CRASHED${NC}"
      fi
    else
      warn "$svc  ${DM}not running${NC}"
    fi
  done
  echo ""
}

# ── Viewer (ffplay preview) ────────────────────────────────────────────────────
open_viewer() {
  load_env
  local disp=":${DISPLAY_NUM:-99}"
  local res="${STREAM_RESOLUTION:-1280x720}"
  local fps="${STREAM_FPS:-60}"
  hdr "  Opening viewer on $disp @ $res"
  if command -v ffplay &>/dev/null; then
    ffplay \
      -f x11grab -video_size "$res" -framerate "$fps" \
      -i "${disp}.0" -vf "scale=iw/2:ih/2" \
      -window_title "ChoctoTV Preview" \
      -loglevel warning -x 960 -y 540 &
    ok "Viewer open (pid $!) — press Q to close"
  else
    warn "ffplay not found — opening overlay in browser"
    local port="${OVERLAY_PORT:-8080}"
    xdg-open "http://localhost:$port" 2>/dev/null &
  fi
}

# ── GitHub update (push current state) ────────────────────────────────────────
# ── Next revision version helper ──────────────────────────────────────────────
# next_revision        → increments minor  (v1.2 → v1.3)
# next_revision major  → increments major  (v1.2 → v2.0)
next_revision() {
  local bump="${1:-minor}"
  local highest
  highest=$(git branch -r 2>/dev/null | grep -E "origin/revision/v[0-9]+\.[0-9]+" |     grep -oE "v[0-9]+\.[0-9]+" | sed 's/v//' | sort -t. -k1,1n -k2,2n | tail -1)
  if [[ -z "$highest" ]]; then
    echo "v1.0"
  else
    local major minor
    major="${highest%%.*}"
    minor="${highest##*.}"
    if [[ "$bump" == "major" ]]; then
      echo "v$((major + 1)).0"
    else
      echo "v${major}.$((minor + 1))"
    fi
  fi
}

# ── GitHub update — push + snapshot revision branch ───────────────────────────
github_update() {
  load_env
  local bump_type="${1:-minor}"  # "major" when called as: ./start.sh update v
  hdr "  Pushing to GitHub${bump_type:+ (major version bump)}"
  cd "$DIR"
  if [[ -z "${GITHUB_REPO:-}" ]]; then warn "GITHUB_REPO not set — run setup to configure"; exit 1; fi

  local branch="${GITHUB_BRANCH:-main}"

  # ── Commit current state to main ──────────────────────────────────────────
  git add -A
  local msg="deploy: $(date '+%Y-%m-%d %H:%M')"
  git diff --cached --quiet && info "Nothing new to commit" || git commit -m "$msg"
  timeout 30 git push origin "$branch" && ok "main pushed to GitHub" || { err "Push to main failed"; exit 1; }

  # ── Update backup branch (mirror of main before this push) ────────────────
  info "Updating backup branch..."
  if git show-ref --verify --quiet refs/remotes/origin/backup 2>/dev/null; then
    # backup exists — update it to the previous main commit
    git push origin "HEAD~1:refs/heads/backup" --force 2>/dev/null       || git push origin "HEAD:refs/heads/backup" --force 2>/dev/null       || warn "Could not update backup branch"
  else
    # First time — create backup branch from current HEAD
    git push origin "HEAD:refs/heads/backup" && ok "backup branch created"
  fi

  # ── Create numbered revision branch ───────────────────────────────────────
  info "Creating revision snapshot..."
  timeout 30 git fetch origin --quiet 2>/dev/null || warn "Could not fetch remote refs"
  local rev
  rev=$(next_revision "$bump_type")
  git push origin "HEAD:refs/heads/revision/${rev}" && ok "revision/${rev} created"

  hdr "${GR}  Update complete${NC}"
  echo -e "  ${DM}main     → latest code${NC}"
  echo -e "  ${DM}backup   → previous build${NC}"
  echo -e "  ${DM}revision/${rev} → this build snapshot${NC}"
}

# ── GitHub rollback ────────────────────────────────────────────────────────────
# Usage:
#   ./start.sh rollback          → restore from backup branch
#   ./start.sh rollback v1.1     → restore from revision/v1.1
#   ./start.sh rollback list     → list all available revisions
github_rollback() {
  load_env
  hdr "  Rollback"
  cd "$DIR"
  if [[ -z "${GITHUB_REPO:-}" ]]; then warn "GITHUB_REPO not set — run setup to configure"; exit 1; fi

  local target="${1:-}"
  timeout 30 git fetch origin --quiet 2>/dev/null || { err "Cannot reach GitHub"; exit 1; }

  # ── List revisions ─────────────────────────────────────────────────────────
  if [[ "$target" == "list" ]]; then
    hdr "  Available revisions:"
    echo ""
    git branch -r | grep "origin/revision/" | sed 's|.*origin/revision/|  → revision/|' | sort -V
    echo ""
    git show-ref --verify --quiet refs/remotes/origin/backup 2>/dev/null       && echo -e "  → ${CY}backup${NC}  (previous build before last update)"       || echo -e "  ${DM}backup branch not yet created${NC}"
    echo ""
    return 0
  fi

  # ── Determine source branch ────────────────────────────────────────────────
  local source_branch
  if [[ -z "$target" ]]; then
    # No argument — use backup branch
    if ! git show-ref --verify --quiet refs/remotes/origin/backup 2>/dev/null; then
      err "No backup branch found. Run './start.sh update' first to create one."
      exit 1
    fi
    source_branch="backup"
    info "Restoring from backup branch (previous build)..."
  else
    # Version specified — use revision/vX.Y
    local rev="${target#v}"
    source_branch="revision/v${rev#revision/v}"
    if ! git show-ref --verify --quiet "refs/remotes/origin/${source_branch}" 2>/dev/null; then
      err "Revision '${source_branch}' not found. Run './start.sh rollback list' to see options."
      exit 1
    fi
    info "Restoring from ${source_branch}..."
  fi

  # ── Apply rollback ─────────────────────────────────────────────────────────
  local prev
  prev=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  git reset --hard "origin/${source_branch}"
  ok "Rolled back from ${prev} → ${source_branch}"

  stop_all
  sleep 1
  ok "Restarting..."
  exec bash "$0"
}

# ── Oracle Cloud deploy ────────────────────────────────────────────────────────
cloud_deploy() {
  load_env
  hdr "  Deploying to Oracle Cloud"
  if [[ -z "${CLOUD_IP:-}" ]]; then warn "CLOUD_IP not set — run setup to configure"; exit 1; fi
  local key="${CLOUD_KEY:-~/.ssh/choctotv.key}"
  local user="${CLOUD_USER:-opc}"
  local dest="${CLOUD_PATH:-/home/opc/choctotv}"
  github_update minor
  ssh -i "$key" "${user}@${CLOUD_IP}" bash -s << REMOTE
    cd "$dest"
    git pull origin ${GITHUB_BRANCH:-main}
    npm install --omit=dev 2>&1 | tail -3
    pm2 restart choctotv || pm2 start app.js --name choctotv
    pm2 save
REMOTE
  ok "Cloud deploy complete"
}

# ── Watchdog ───────────────────────────────────────────────────────────────────
start_watchdog() {
  while true; do
    sleep 15
    for svc in app music; do
      local f="$PIDS/$svc.pid"
      [[ -f "$f" ]] || continue
      local pid; pid=$(cat "$f")
      if ! kill -0 "$pid" 2>/dev/null; then
        echo -e "\n${YL}  ⚠${NC} $svc crashed — restarting..."
        case "$svc" in
          app)   node "$DIR/app.js"   >> "$LOGS/app.log"   2>&1 & ;;
          music) node "$DIR/music.js" >> "$LOGS/music.log" 2>&1 & ;;
        esac
        echo $! > "$f"
        echo -e "${GR}  ✓${NC} $svc restarted"
      fi
    done
    # stream.js manages its own FFmpeg restarts internally
  done
}

# ── Command console (foreground) ───────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────────────────────
#  Main dispatch
# ─────────────────────────────────────────────────────────────────────────────
case "${1:-start}" in
  stop)     stop_all; exit 0 ;;
  restart)  stop_all; sleep 1 ;;
  status)   show_status; exit 0 ;;
  setup)    exec node "$DIR/setup.js" ;;
  viewer)   open_viewer; exit 0 ;;
  update)
    if [[ "${2:-}" == "v" ]]; then github_update major; else github_update minor; fi
    exit 0 ;;
  rollback) github_rollback "${2:-}"; exit 0 ;;
  deploy)   cloud_deploy; exit 0 ;;
  chat)     exec node "$DIR/chat.js" ;;
  monitor)  exec node "$DIR/monitor.js" ;;
  kill|killswitch) exec bash "$DIR/killswitch.sh" ;;
  session)
    SESSION_DIR="$LOGS/sessions"
    mkdir -p "$SESSION_DIR"
    if [[ -z "${2:-}" ]]; then
      echo ""
      echo -e "\033[1;37m  Session Logs\033[0m"
      echo ""
      ls -lt "$SESSION_DIR"/*.log 2>/dev/null | grep -v "latest.log" | awk '{print "  "$6" "$7"  "substr($9,index($9,"sessions/")+9)}' || echo "  No session logs yet"
      echo ""
    elif [[ "${2}" == "latest" ]]; then
      latest=$(ls -t "$SESSION_DIR"/*.log 2>/dev/null | grep -v "latest.log" | head -1)
      [[ -n "$latest" ]] && less +G "$latest" || echo "No session logs found"
    else
      match=$(ls "$SESSION_DIR"/*"${2}"*.log 2>/dev/null | grep -v "latest.log" | head -1)
      [[ -n "$match" ]] && less +G "$match" || echo "No session matching: ${2}"
    fi
    exit 0 ;;
  start|"") ;;
  *) echo "Usage: ./start.sh [start|stop|restart|status|setup|viewer|chat|monitor|session|update|rollback|deploy|kill]"; exit 1 ;;
esac

# ── Check setup has been run ───────────────────────────────────────────────────
load_env
if [[ -z "${TWITCH_CHANNEL:-}" ]]; then
  warn "Not configured yet — running setup..."
  echo ""
  node "$DIR/setup.js"
  load_env
fi

# ── Kill any stale pids ────────────────────────────────────────────────────────
for svc in app stream music; do kill_pid "$svc" 2>/dev/null || true; done

# ── Session log setup ─────────────────────────────────────────────────────────
SESSION_DIR="$LOGS/sessions"
mkdir -p "$SESSION_DIR"
SESSION_TS=$(date '+%Y-%m-%d_%H-%M-%S')
SESSION_LOG="$SESSION_DIR/${SESSION_TS}.log"
SESSION_LINK="$SESSION_DIR/latest.log"

# Write session header
{
  echo "════════════════════════════════════════════════════════"
  echo "  ChoctoTV Session Log"
  echo "  Started:  $(date '+%Y-%m-%d %H:%M:%S')"
  echo "  Channel:  #${TWITCH_CHANNEL:-unknown}"
  echo "  Build:    $(cd "$DIR" && git rev-parse --short HEAD 2>/dev/null || echo 'local')"
  echo "════════════════════════════════════════════════════════"
  echo ""
} > "$SESSION_LOG"

# Symlink latest
ln -sf "$SESSION_LOG" "$SESSION_LINK"

# Keep only the last 10 sessions — delete oldest beyond that
ls -t "$SESSION_DIR"/*.log 2>/dev/null | grep -v "latest.log" | tail -n +11 | while read -r old_log; do
  rm -f "$old_log"
done

# Tee all subsequent stdout/stderr to session log (without breaking terminal colors)
# Use a background tail so the terminal still shows output
exec > >(tee -a "$SESSION_LOG") 2>&1

info "Session log: $SESSION_LOG"
SESSION_START=$(date +%s)

# ── Banner ─────────────────────────────────────────────────────────────────────
echo ""
hdr "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
hdr "  ChoctoTV — Starting"
hdr "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Launch services ────────────────────────────────────────────────────────────
launch app    app.js    app.log    3
launch music  music.js  music.log  1
launch stream stream.js stream.log 2

# ── Ready banner ───────────────────────────────────────────────────────────────
echo ""
hdr "${GR}━━━  ChoctoTV Live  ━━━${NC}"
echo -e "  ${CY}Channel${NC}  #${TWITCH_CHANNEL:-?}"
echo -e "  ${CY}Overlay${NC}  http://localhost:${OVERLAY_PORT:-8080}"
echo -e "  ${CY}API${NC}      http://localhost:${API_PORT:-3000}"
echo ""
echo -e "  ${DM}./start.sh stop      stop everything${NC}"
echo -e "  ${DM}./start.sh status    service health${NC}"
echo -e "  ${DM}./start.sh viewer    preview window${NC}"
echo -e "  ${DM}./start.sh chat      send commands as streamer${NC}"
echo -e "  ${DM}./start.sh monitor   live CPU/RAM/GPU performance monitor${NC}"
echo -e "  ${DM}./start.sh kill      stop everything${NC}"
echo -e "  ${DM}./start.sh session           list all session logs${NC}"
echo -e "  ${DM}./start.sh session latest    view last session log${NC}"
echo -e "  ${DM}./start.sh update    push to GitHub${NC}"
echo -e "  ${DM}./start.sh rollback           restore backup (previous build)${NC}"
echo -e "  ${DM}./start.sh rollback v1.1      restore specific revision${NC}"
echo -e "  ${DM}./start.sh rollback list      list all revisions${NC}"
echo -e "  ${DM}./start.sh deploy    push to Oracle Cloud${NC}"
echo -e "  ${DM}Ctrl+C to stop${NC}"

# ── Trap Ctrl+C ───────────────────────────────────────────────────────────────
cleanup() {
  echo ""
  info "Shutting down — killing all services..."

  # Write session footer
  {
    echo ""
    echo "════════════════════════════════════════════════════════"
    echo "  Session ended: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "  Duration: $(($(date +%s) - SESSION_START))s"
    echo "════════════════════════════════════════════════════════"
  } >> "$SESSION_LOG" 2>/dev/null || true

  # Polite stop first
  stop_all
  sleep 1

  # Nuclear fallback — kill anything still running
  pkill -9 -f "node $DIR/app.js"    2>/dev/null || true
  pkill -9 -f "node $DIR/stream.js" 2>/dev/null || true
  pkill -9 -f "node $DIR/music.js"  2>/dev/null || true
  pkill -9 -f "ffmpeg"              2>/dev/null || true
  pkill -9 -f "Xvfb :${DISPLAY_NUM:-99}" 2>/dev/null || true
  pkill -9 -f "chromium"            2>/dev/null || true
  pkill -9 -f "xcompmgr"            2>/dev/null || true
  pkill -9 -f "unclutter"           2>/dev/null || true

  # Clean up tmp files
  rm -f /tmp/choctotv_music_ctrl.json /tmp/choctotv_music_state.json 2>/dev/null || true

  ok "All stopped. Goodbye."
  exit 0
}
trap cleanup SIGINT SIGTERM

# ── Watchdog in background ────────────────────────────────────────────────────
start_watchdog &

wait
