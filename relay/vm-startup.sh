#!/bin/bash
# Runs on every boot of the relay VM (Debian 12, e2-micro). Installs Node 24 and Caddy once, then runs
# the relay behind Caddy, which gets the HTTPS certificate for <ip-with-dashes>.sslip.io by itself.
# The relay code comes from the VM's metadata (key "relay-js"), so a deploy needs no SSH: deploy.mjs
# updates the metadata and the watcher below swaps the file and restarts the relay.
set -euo pipefail
MD=http://metadata.google.internal/computeMetadata/v1
md() { curl -fsS -H 'Metadata-Flavor: Google' "$MD/$1"; }

if ! node -v 2>/dev/null | grep -q '^v24'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

mkdir -p /opt/dw
md 'instance/attributes/relay-js' > /opt/dw/relay.mjs || echo 'console.log("no relay code yet")' > /opt/dw/relay.mjs

IP=$(md 'instance/network-interfaces/0/access-configs/0/external-ip')
HOST="${IP//./-}.sslip.io"
cat > /etc/caddy/Caddyfile <<EOF
$HOST {
  encode gzip
  reverse_proxy 127.0.0.1:8080 {
    flush_interval -1
  }
}
EOF
systemctl reload caddy || systemctl restart caddy

cat > /etc/systemd/system/dw-relay.service <<'EOF'
[Unit]
Description=Dreamwalker relay
After=network-online.target
StartLimitIntervalSec=0
[Service]
Environment=PORT=8080
ExecStart=/usr/bin/node /opt/dw/relay.mjs
Restart=always
RestartSec=1
DynamicUser=yes
MemoryMax=600M
[Install]
WantedBy=multi-user.target
EOF

# Waits for a new "relay-js" in the metadata (long poll), then swaps the file and restarts the relay.
cat > /opt/dw/watch.sh <<'EOF'
#!/bin/bash
MD=http://metadata.google.internal/computeMetadata/v1/instance/attributes/relay-js
etag() { awk 'tolower($1)=="etag:"{print $2}' | tr -d '\r'; }
ETAG=$(curl -fsS -D - -o /dev/null -H 'Metadata-Flavor: Google' "$MD" | etag)
while true; do
  OUT=$(mktemp)
  # No code yet = nothing to wait on: poll plainly until the first deploy arrives.
  if [ -n "$ETAG" ]; then Q="?wait_for_change=true&timeout_sec=600&last_etag=$ETAG"; else Q=""; fi
  if HDR=$(curl -fsS -D - -o "$OUT" -H 'Metadata-Flavor: Google' "$MD$Q"); then
    NEW=$(echo "$HDR" | etag)
    if [ -n "$NEW" ] && [ "$NEW" != "$ETAG" ] && [ -s "$OUT" ]; then
      install -m 644 "$OUT" /opt/dw/relay.mjs
      systemctl reset-failed dw-relay || true
      systemctl restart dw-relay
      ETAG=$NEW
    fi
  else
    sleep 5
  fi
  rm -f "$OUT"
done
EOF
chmod +x /opt/dw/watch.sh
cat > /etc/systemd/system/dw-watch.service <<'EOF'
[Unit]
Description=Dreamwalker relay updater
After=network-online.target
[Service]
ExecStart=/opt/dw/watch.sh
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable dw-relay dw-watch
systemctl restart dw-relay dw-watch
