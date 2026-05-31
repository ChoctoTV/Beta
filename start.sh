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
PIDS="$DIR/data/.pids"
LOGS="$DIR/data/logs"
mkdir -p "$PIDS" "$LOGS"

# ── Legacy: auto-copy alternate-named env files → .env if .env missing ───────
for SECRET_SRC in "$DIR/vault.env" "$DIR/.vault.env" "$DIR/teller.env"; do
  if [ -f "$SECRET_SRC" ] && [ ! -f "$DIR/vault/.env" ]; then
    echo "[start.sh] Found $(basename $SECRET_SRC) → copying to vault/.env"
    cp "$SECRET_SRC" "$DIR/vault/.env"
    break
  fi
done


GR='\033[0;32m'; YL='\033[0;33m'; RD='\033[0;31m'
CY='\033[0;36m'; WT='\033[1;37m'; DM='\033[2m'; NC='\033[0m'
ok()   { echo -e "${GR}  ✓${NC} $*"; }
info() { echo -e "${CY}  →${NC} $*"; }
warn() { echo -e "${YL}  ⚠${NC} $*"; }
err()  { echo -e "${RD}  ✗${NC} $*"; }
hdr()  { echo -e "\n${WT}$*${NC}"; }


# ── Load Secret file directly (before services start) ──────────────────────────
load_secret() {
  local sf=""
  # Allow override via env var (used by 'start.sh test')
  if [[ -n "${CHOCTOTV_SECRET_FILE:-}" && -f "$CHOCTOTV_SECRET_FILE" ]]; then
    sf="$CHOCTOTV_SECRET_FILE"
  else
    for candidate in "$DIR/vault/secret.txt" "$DIR/vault/Secret.txt" "$DIR/vault/Secret(live).txt" "$DIR/vault/Secret(beta).txt"; do
      [[ -f "$candidate" ]] && sf="$candidate" && break
    done
    if [[ -z "$sf" ]]; then
      for f in "$DIR"/[Ss]ecret*.txt; do [[ -f "$f" ]] && sf="$f" && break; done
    fi
  fi
  if [[ -n "$sf" ]]; then
    set -a
    while IFS= read -r line; do
      [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
      line="${line%%  #*}"; line="${line%%	#*}"
      [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] && export "$line" 2>/dev/null || true
    done < "$sf"
    set +a
  fi
}

# ── Load .env ──────────────────────────────────────────────────────────────────
load_env() {
  [[ -f "$DIR/vault/.env" ]] || return 0
  while IFS='=' read -r key rest; do
    # Skip blank lines, comments, and keys that aren't valid shell identifiers
    [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    # Skip values that look like URLs (contain ://) — these break bash source
    [[ "$rest" =~ :// ]] && continue
    export "${key}=${rest}"
  done < "$DIR/vault/.env"
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
  ensure_clean
  ok "All stopped"
}

# ── Status ─────────────────────────────────────────────────────────────────────
show_status() {
  hdr "  ChoctoTV — Service Status"
  echo ""
  for svc in app stream music pupcore teller; do
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
    local port="${API_PORT:-3000}"
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
  # Crash-loop guard: if a service crashes 3+ times in 60 seconds, give up
  # restarting it so the user can Ctrl+C without fighting the restart loop.
  declare -A crash_count
  declare -A crash_first
  declare -A crash_disabled

  while true; do
    sleep 15
    for svc in app music; do
      [[ "${crash_disabled[$svc]:-0}" == "1" ]] && continue
      local f="$PIDS/$svc.pid"
      [[ -f "$f" ]] || continue
      local pid; pid=$(cat "$f")
      if ! kill -0 "$pid" 2>/dev/null; then
        local now=$(date +%s)
        local first=${crash_first[$svc]:-$now}
        local count=${crash_count[$svc]:-0}
        # Reset window if it's been more than 60s since the first crash
        if (( now - first > 60 )); then
          crash_first[$svc]=$now
          crash_count[$svc]=1
        else
          crash_count[$svc]=$((count + 1))
        fi

        if (( ${crash_count[$svc]} >= 3 )); then
          echo -e "\n${RD}  ✗${NC} $svc crashed 3+ times in 60s — giving up. Check $LOGS/$svc.log"
          echo -e "${DM}     Fix the issue and run: ./start.sh restart${NC}"
          crash_disabled[$svc]=1
          rm -f "$f"
          continue
        fi

        echo -e "\n${YL}  ⚠${NC} $svc crashed (attempt ${crash_count[$svc]}/3) — restarting..."
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
#  First-run bootstrap: if node_modules or .bootstrapped missing, run firststart.sh
# ─────────────────────────────────────────────────────────────────────────────
_do_bootstrap() {
  local mode="${1:-}"
  if [[ ! -f "$DIR/.bootstrapped" || ! -d "$DIR/node_modules" ]]; then
    if [[ ! -f "$DIR/firststart.sh" ]]; then
      err "firststart.sh not found — cannot bootstrap"
      exit 1
    fi
    info "First run detected — running bootstrap..."
    bash "$DIR/firststart.sh" "$mode"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
#  Main dispatch
# ─────────────────────────────────────────────────────────────────────────────
case "${1:-start}" in
  test)
    _do_bootstrap test
    if [[ ! -f "$DIR/vault/testzone.txt" ]]; then
      echo -e "${RD}  ✗${NC} testzone.txt not found — unzip vault.zip first"
      exit 1
    fi
    export CHOCTOTV_SECRET_FILE="$DIR/vault/testzone.txt"
    echo -e "${YL}  ⚠${NC} TEST MODE — loading testzone.txt"
    exec "$0" start
    ;;
  stop)     stop_all; exit 0 ;;
  restart)  stop_all; sleep 1 ;;
  status)   show_status; exit 0 ;;
  reload)
    # Hot-reload commands without restarting: POST to running app
    SVC="${2:-commands}"
    if [[ "$SVC" == "commands" || "$SVC" == "cmd" ]]; then
      if curl -sf -X POST http://localhost:${API_PORT:-3000}/admin/reload -o /dev/null; then
        ok "Commands hot-reloaded"
      else
        err "Could not reach app — is it running? (./start.sh status)"
      fi
    elif [[ "$SVC" == "teller" ]]; then
      info "Restarting teller..."
      kill_pid teller 2>/dev/null || true
      pkill -TERM -f "node $DIR/teller.js" 2>/dev/null || true
      sleep 1
      start_svc teller "node $DIR/teller.js"
      ok "Teller restarted"
    else
      echo "Usage: ./start.sh reload [commands|teller]"
    fi
    exit 0 ;;
  setup)    exec node "$DIR/setup.js" ;;
  viewer)
    # Pass streamBuffer=0 so preview shows animations instantly (no stream delay)
    load_env
    chromium-browser --app="http://localhost:${API_PORT:-3000}?streamBuffer=0" &
    exit 0 ;;
  update)
    # Bump build counter before pushing
    BUILD_FILE="$DIR/.build"
    BUILD=$(( $(cat "$BUILD_FILE" 2>/dev/null || echo 0) + 1 ))
    echo "$BUILD" > "$BUILD_FILE"
    info "Build #$BUILD"
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
  verifyenv)
    SECRET_FILE=""
    for c in "vault/secret.txt" "vault/Secret.txt" "vault/Secret(live).txt" "vault/Secret(beta).txt"; do
      [ -f "$DIR/$c" ] && { SECRET_FILE="$DIR/$c"; break; }
    done
    if [ -z "$SECRET_FILE" ]; then
      # No Secret file — check the loaded environment instead
      echo "No Secret file found. Checking loaded environment variables..."
      echo ""
      load_env 2>/dev/null || true
      MISSING=0
      for key in TWITCH_CHANNEL TWITCH_BOT_USERNAME TWITCH_CLIENT_ID TWITCH_STREAM_KEY HELIUS_API_KEY; do
        val="${!key:-}"
        if [ -n "$val" ]; then
          # Mask secrets in display
          disp="$val"
          case "$key" in TWITCH_STREAM_KEY|HELIUS_API_KEY|TWITCH_OAUTH_TOKEN) disp="${val:0:6}…(set)";; esac
          printf '  ✓ %-22s = %s\n' "$key" "$disp"
        else
          printf '  ✗ %-22s = <MISSING>\n' "$key"
          MISSING=$((MISSING+1))
        fi
      done
      echo ""
      if [ "$MISSING" -gt 0 ]; then
        echo "  $MISSING required value(s) missing from environment."
        echo "  Run ./start.sh resetenv to create a Secret file, then ./start.sh verifyenv to fill it."
        exit 1
      else
        ok "All required environment variables present"
        exit 0
      fi
    fi
    echo "Reviewing: $SECRET_FILE  (y=keep, n=edit)"
    TMPFILE=$(mktemp)
    while IFS= read -r line; do
      if [[ "$line" =~ ^[[:space:]]*# ]] || [[ -z "${line// }" ]]; then
        printf '%s\n' "$line" >> "$TMPFILE"; continue
      fi
      if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
        KEY="${BASH_REMATCH[1]}"; VAL="${BASH_REMATCH[2]}"
        printf '  %-30s = %s\n' "$KEY" "${VAL:-<empty>}"
        read -rp "  Correct? [y/n]: " ans < /dev/tty
        if [[ "$ans" == "n" || "$ans" == "N" ]]; then
          read -rp "  New value for $KEY: " newval < /dev/tty
          printf '%s=%s\n' "$KEY" "$newval" >> "$TMPFILE"
        else
          printf '%s\n' "$line" >> "$TMPFILE"
        fi
      else
        printf '%s\n' "$line" >> "$TMPFILE"
      fi
    done < "$SECRET_FILE"
    for key in TWITCH_CHANNEL TWITCH_BOT_USERNAME TWITCH_CLIENT_ID TWITCH_STREAM_KEY HELIUS_API_KEY; do
      if ! grep -qP "^${key}=.+" "$TMPFILE" 2>/dev/null; then
        printf '\n  ⚠  %s is missing or empty\n' "$key"
        read -rp "  Enter value for $key: " newval < /dev/tty
        if grep -q "^${key}=" "$TMPFILE"; then
          sed -i "s|^${key}=.*|${key}=${newval}|" "$TMPFILE"
        else
          printf '%s=%s\n' "$key" "$newval" >> "$TMPFILE"
        fi
      fi
    done
    cp "$TMPFILE" "$SECRET_FILE"; rm -f "$TMPFILE"
    echo ""; ok "$SECRET_FILE updated — run ./start.sh to apply"
    exit 0 ;;

  resetenv)
    DEST="$DIR/vault/secret.txt"
    if [ -f "$DEST" ]; then
      read -rp "secret.txt exists — overwrite? [y/n]: " ans < /dev/tty
      [[ "$ans" != "y" && "$ans" != "Y" ]] && { echo "Cancelled."; exit 0; }
      cp "$DEST" "${DEST}.bak.$(date +%s)"
      ok "Backed up existing file"
    fi
    cp "$DIR/Secret.template.txt" "$DEST"
    ok "Created fresh secret.txt — fill in values then run ./start.sh verifyenv"
    exit 0 ;;

  verifytoken)
    # Validate the current OAuth token against Twitch and show its account + scopes
    load_env
    export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" --silent
    node -e '
      const https=require("https");
      const raw=(process.env.TWITCH_OAUTH_TOKEN||"").replace(/^oauth:/,"");
      if(!raw){console.log("✗ No TWITCH_OAUTH_TOKEN set");process.exit(1);}
      https.request({hostname:"id.twitch.tv",path:"/oauth2/validate",headers:{Authorization:"OAuth "+raw}},r=>{
        let d="";r.on("data",c=>d+=c);r.on("end",()=>{
          if(r.statusCode!==200){console.log("✗ Token INVALID/EXPIRED (status "+r.statusCode+")");process.exit(1);}
          const j=JSON.parse(d);
          console.log("✓ Token VALID");
          console.log("  Account:  "+j.login);
          console.log("  Expires:  "+Math.round(j.expires_in/3600)+"h");
          console.log("  Scopes:   "+(j.scopes||[]).join(", "));
          const need=["chat:read","chat:edit"];
          const missing=need.filter(s=>!(j.scopes||[]).includes(s));
          if(missing.length)console.log("  ⚠ MISSING for chat: "+missing.join(", "));
          else console.log("  ✓ Has chat:read + chat:edit (commands will work)");
          console.log("");
          console.log("  IMPORTANT: TWITCH_BOT_USERNAME should be \""+j.login+"\" (or leave it — token account is used automatically)");
        });
      }).on("error",e=>{console.log("✗ Network error: "+e.message);process.exit(1);}).end();
    '
    exit 0 ;;

  updatescopes)
    info "Stopping app to refresh Twitch OAuth..."
    kill_pid app 2>/dev/null || true; pkill -TERM -f "node $DIR/src/app.js" 2>/dev/null || true; sleep 1
    load_env
    export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" --silent
    node "$DIR/src/scripts/updatescopes.js"
    echo ""; ok "Run ./start.sh to restart with the new token"
    exit 0 ;;

  start|"") _do_bootstrap ;;
  *) echo "Usage: ./start.sh [start|stop|restart|status|setup|viewer|chat|monitor|session|update|rollback|deploy|kill|verifyenv|resetenv|updatescopes]"; exit 1 ;;
esac


# ── Mirror secret.txt / testzone.txt → .env so every process reads the same values ──
# secret.txt (or testzone.txt for test mode) is the human-friendly editor;
# .env is what every node process actually loads via dotenv.
_sf="${CHOCTOTV_SECRET_FILE:-}"
if [[ -z "$_sf" ]]; then
  for _c in "$DIR/vault/secret.txt" "$DIR/vault/Secret.txt"; do
    [[ -f "$_c" ]] && _sf="$_c" && break
  done
fi
if [[ -n "$_sf" ]]; then
  mkdir -p "$DIR/vault"
  cp "$_sf" "$DIR/vault/.env"
fi

# ── Generate webhook JSON configs from env vars ────────────────────────────────
# Reads TIPBOT_WEBHOOK_URL + auth from vault/.env and writes the two JSON files
# that Teller.js uses at runtime.  These files are gitignored (vault/*).
node "$DIR/src/scripts/genWebhookConfigs.js"

# ── Write billboard manifest (static JSON read by browser, no server call needed) ──
node -e "
const fs   = require('fs');
const path = require('path');
const base = path.join('$DIR', 'vault', 'billboard');
['main','ads','review'].forEach(d => fs.mkdirSync(path.join(base,d),{recursive:true}));
const isImg = f => !/\.(txt|md|json|js|sh|log)$/i.test(f) && !f.startsWith('.');
const main = fs.readdirSync(path.join(base,'main')).filter(isImg).sort()
  .map(f => './assets/billboard/main/' + encodeURIComponent(f));
const ads  = fs.readdirSync(path.join(base,'ads')).filter(isImg).sort()
  .map(f => './assets/billboard/ads/'  + encodeURIComponent(f));
fs.writeFileSync(path.join(base,'manifest.json'), JSON.stringify({main,ads},null,2));
console.log('[start.sh] billboard manifest: main=' + main.length + ' ads=' + ads.length);
" 2>&1


# ── Ensure billboard subfolders exist ────────────────────────────────────────
mkdir -p "$DIR/vault/billboard/main"
mkdir -p "$DIR/vault/billboard/ads"
mkdir -p "$DIR/vault/billboard/review"

# ── Auto-install assets.zip if present in project root ───────────────────────
# Drop assets.zip (matching the filetree from project root) into the folder
# before running start.sh and it will be extracted automatically on launch.
if [[ -f "$DIR/assets.zip" ]]; then
  echo "[start.sh] assets.zip found — extracting assets to project..."
  unzip -o "$DIR/assets.zip" -d "$DIR" >> "$LOGS/app.log" 2>&1     && echo "[start.sh] ✓ assets installed from assets.zip"     || echo "[start.sh] ⚠ assets.zip extraction had errors — check logs/app.log"
fi

# ── Check setup has been run ───────────────────────────────────────────────────
load_env
if [[ -z "${TWITCH_CHANNEL:-}" ]]; then
  warn "Not configured yet — running setup..."
  echo ""
  node "$DIR/setup.js"
  load_env
fi

# ── Ensure clean slate before starting ────────────────────────────────────────
ensure_clean() {
  # 1. Kill by PID files
  for svc in app stream music pupcore teller; do kill_pid "$svc" 2>/dev/null || true; done

  # 2. Kill by process name (catches anything that didn't write a PID file)
  pkill -TERM -f "node $DIR/src/app.js"     2>/dev/null || true
  pkill -TERM -f "node $DIR/pupcore.js" 2>/dev/null || true
  pkill -TERM -f "node $DIR/teller.js"  2>/dev/null || true
  pkill -TERM -f "node $DIR/music.js"   2>/dev/null || true
  pkill -TERM -f "node $DIR/stream.js"  2>/dev/null || true
  kill_pid backup 2>/dev/null || true
  pkill -TERM -f "node $DIR/monitor.js" 2>/dev/null || true
  pkill -TERM -x mpv 2>/dev/null || true   # kill any stray music player

  # 3. Give processes 2s to exit gracefully
  sleep 2

  # 4. Force-kill anything still alive
  pkill -KILL -f "node $DIR/src/app.js"     2>/dev/null || true
  pkill -KILL -f "node $DIR/pupcore.js" 2>/dev/null || true
  pkill -KILL -f "node $DIR/teller.js"  2>/dev/null || true
  pkill -KILL -f "node $DIR/music.js"   2>/dev/null || true
  pkill -KILL -f "node $DIR/stream.js"  2>/dev/null || true
  kill_pid backup 2>/dev/null || true
  pkill -KILL -x mpv 2>/dev/null || true   # force-kill stray mpv

  # 5. Free all required ports — wait until confirmed clear
  local ports="3000 3001 3002 3003"
  fuser -k 3000/tcp 3001/tcp 3002/tcp 3003/tcp 2>/dev/null || true
  local waited=0
  for port in $ports; do
    while fuser "$port/tcp" &>/dev/null && [ $waited -lt 10 ]; do
      sleep 0.5; waited=$((waited+1))
    done
  done

  # 6. Remove Xvfb locks so stream.js can start cleanly
  rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true

  # 7. Clean up stale PID files
  rm -f "$PIDS"/*.pid 2>/dev/null || true

  # 8. Clean up music ctrl file
  rm -f /tmp/choctotv_music_ctrl.json 2>/dev/null || true
}
ensure_clean

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
launch pupcore pupcore.js pupcore.log 2
launch teller  teller.js  teller.log 1
launch app     src/app.js app.log    3
launch music   music.js   music.log  1
launch stream  stream.js  stream.log 2

# ── Ready banner ───────────────────────────────────────────────────────────────
echo ""
hdr "${GR}━━━  ChoctoTV Live  ━━━${NC}"
echo -e "  ${CY}Channel${NC}  #${TWITCH_CHANNEL:-?}"
echo -e "  ${CY}Overlay${NC}  http://localhost:${API_PORT:-3000}"
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
  pkill -9 -f "node $DIR/pupcore.js" 2>/dev/null || true
  pkill -9 -f "node $DIR/teller.js"  2>/dev/null || true
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


# ── Hourly DB backup ──────────────────────────────────────────────────────────
# Zips all .db files every hour into backups/db_YYYY-MM-DD_HH-MM.zip
# Keeps the last 168 backups (7 days × 24 hrs). Runs silently in background.
BACKUP_DIR="$DIR/backups"
mkdir -p "$BACKUP_DIR"
(
  while true; do
    sleep 3600
    _ts=$(date +"%Y-%m-%d_%H-%M")
    _out="$BACKUP_DIR/db_${_ts}.zip"
    # Find all .db files and zip them
    _dbs=$(find "$DIR" -maxdepth 3 -name "*.db" ! -path "*/node_modules/*" 2>/dev/null)
    if [[ -n "$_dbs" ]]; then
      echo "$_dbs" | xargs zip -q "$_out" 2>/dev/null \
        && echo "[backup] DB snapshot → $(basename $_out)" >> "$LOGS/backup.log" \
        || echo "[backup] WARNING: db zip failed at $_ts" >> "$LOGS/backup.log"
    fi
    # Keep only the last 168 db backups (7 days)
    ls -t "$BACKUP_DIR"/db_*.zip 2>/dev/null | tail -n +169 | xargs rm -f 2>/dev/null

    # Assets backup — single overwritten file (assets change rarely; no need to timestamp)
    if [[ -d "$DIR/vault" ]]; then
      zip -qr "$BACKUP_DIR/assets.zip" "$DIR/vault/" --exclude "*.log" 2>/dev/null \
        && echo "[backup] assets.zip updated at $_ts" >> "$LOGS/backup.log" \
        || echo "[backup] WARNING: assets zip failed at $_ts" >> "$LOGS/backup.log"
    fi
  done
) &
echo "$!" > "$PIDS/backup.pid"

wait
