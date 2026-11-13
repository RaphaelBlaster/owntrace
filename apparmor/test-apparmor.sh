#!/usr/bin/env bash
# Run from the repo root on an AppArmor host, with the stack already started using
# docker-compose.apparmor.yml (see DEPLOY.md).
cd "$(dirname "$0")/.." || exit 1
fail=0
pass() { echo "PASS  $1"; }
bad()  { echo "FAIL  $1"; fail=1; }
check() { # check <expect: ok|deny> <label> <cmd...>
  local expect=$1 label=$2 r; shift 2
  if "$@" >/dev/null 2>&1; then r=ok; else r=deny; fi
  if [ "$r" = "$expect" ]; then pass "$label"; else bad "$label"; fi
}

sudo apparmor_parser -r -W apparmor/owntrace-* || { echo "FAIL  profile load"; exit 1; }
status=$(sudo aa-status)

for svc in api mail-worker rag; do
  x="docker compose exec -T $svc"
  cid=$(docker compose ps -q "$svc")
  prof=$(docker inspect --format '{{.AppArmorProfile}}' "$cid" 2>/dev/null)
  [ "$prof" = "owntrace-$svc" ] && pass "$svc: container runs profile owntrace-$svc" || bad "$svc: container profile is '$prof'"
  # aa-status prints enforce-mode profiles under "profiles are in enforce mode" before the complain section.
  if echo "$status" | sed '/in complain mode/,$d' | grep -qx "[[:space:]]*owntrace-$svc"; then
    pass "$svc: profile loaded in enforce mode"
  else bad "$svc: profile not in enforce mode"; fi

  out=$($x node -e "console.log('ok')" 2>/dev/null | tr -d '\r')
  [ "$out" = ok ] && pass "$svc: node prints ok" || bad "$svc: node prints ok"
  check ok   "$svc: /tmp write permitted"        $x node -e "require('fs').writeFileSync('/tmp/t','1')"
  check deny "$svc: shell exec denied"           $x node -e "require('child_process').execFileSync('/bin/sh',['-c','true'])"
  check deny "$svc: write /app denied"           $x node -e "require('fs').writeFileSync('/app/x','1')"
  # Dropped-file exec: copy node into /tmp (allowed write), then exec it; /tmp/** has no x permission.
  check deny "$svc: exec of dropped file denied" $x node -e "const fs=require('fs');fs.copyFileSync('/usr/local/bin/node','/tmp/n');fs.chmodSync('/tmp/n',0o755);require('child_process').execFileSync('/tmp/n',['-v'])"
done

# /etc/shadow exists in node:22-bookworm-slim but DAC may block it for a non-root user, so it is
# not a clean proof. /etc/debian_version is world-readable, a real file (os-release is a symlink into /usr/lib), and is not in
# abstractions/base nor rag's allow list, so only AppArmor can deny it (shadow kept as a bonus).
check deny "rag: read /etc/debian_version denied (outside allow list)" docker compose exec -T rag node -e "require('fs').readFileSync('/etc/debian_version')"
check deny "rag: read /etc/shadow denied" docker compose exec -T rag node -e "require('fs').readFileSync('/etc/shadow')"

echo
echo "See denials : sudo dmesg | grep -i apparmor   (or: journalctl -k | grep DENIED)"
exit $fail
