#!/usr/bin/env bash
#
# verify-deviceadmin.sh -- READ-ONLY DeviceAdmin verification for the "qi" app.
#
# Answers the four checks from docs/react-refactor/v0.6.3-deviceadmin.md section 7:
#   1. Is the "qi" device admin listed / activatable?
#   2. Does the app hold the permission lockNow() needs? (screen-lock itself must
#      be triggered from inside the app; this script only reports preconditions)
#   3. After revoking, would GuardModule.lockNow() reject with device_admin_missing?
#   4. After revoking, is the admin gone from the system admin list?
#
# GUARANTEES
#   * Never enables/disables an admin, never installs/uninstalls, never changes
#     settings, never starts an activity, never clears logs or stats.
#   * Only runs: adb devices, adb shell getprop, adb shell pm list packages,
#     adb shell dumpsys package/device_policy/activity/power/notification,
#     adb shell settings get, adb shell dpm list-owners.
#   * Exit codes: 0 = checks ran, 2 = adb not found, 3 = no device.
#
# USAGE
#   bash tools/verify-deviceadmin.sh                # auto-pick a device
#   bash tools/verify-deviceadmin.sh emulator-5556  # explicit serial
#   ADB=/path/to/adb bash tools/verify-deviceadmin.sh
#
# Works in Windows MSYS/Git-Bash, Linux and macOS.

set -u

PKG="com.green.inori"
RECEIVER="$PKG/com.inorinal.qi.QiDeviceAdminReceiver"

# Repo root (this script lives in tools/). Used only to resolve source anchors at
# run time, so the printed line numbers can never go stale after a refactor.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd || echo "")"

# ---------------------------------------------------------------- adb discovery
find_adb() {
  if [ -n "${ADB:-}" ] && [ -x "$ADB" ]; then echo "$ADB"; return 0; fi
  if command -v adb >/dev/null 2>&1; then command -v adb; return 0; fi
  for c in \
    "${LOCALAPPDATA:-}/Android/Sdk/platform-tools/adb.exe" \
    "${HOME:-}/Android/Sdk/platform-tools/adb" \
    "${ANDROID_HOME:-}/platform-tools/adb" \
    "${ANDROID_SDK_ROOT:-}/platform-tools/adb" \
    "/c/Users/$USER/AppData/Local/Android/Sdk/platform-tools/adb.exe" \
    "/usr/local/bin/adb" "/usr/bin/adb"; do
    [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return 0; }
  done
  return 1
}

ADB_BIN="$(find_adb)" || {
  echo "ERROR: adb not found. Set ADB=/path/to/adb and retry." >&2
  exit 2
}

hr() { printf '%s\n' "------------------------------------------------------------"; }
sec() { printf '\n=== %s ===\n' "$1"; }
cmd() { printf '$ %s\n' "$*"; }

# shellcheck disable=SC2086
sh() { "$ADB_BIN" -s "$SERIAL" shell "$@" 2>&1; }

# ---------------------------------------------------------------- device select
sec "0. adb / devices"
cmd "$ADB_BIN version"
"$ADB_BIN" version 2>&1 | head -3
cmd "$ADB_BIN devices -l"
DEVS_OUT="$("$ADB_BIN" devices -l 2>&1)"
printf '%s\n' "$DEVS_OUT"

if [ -n "${1:-}" ]; then
  SERIAL="$1"
else
  SERIAL="$(printf '%s\n' "$DEVS_OUT" | awk '/^[^ ]+[ \t]+device/ {print $1; exit}')"
fi

if [ -z "${SERIAL:-}" ]; then
  echo "ERROR: no device in 'device' state. Boot an emulator or plug in a phone." >&2
  exit 3
fi

if ! printf '%s\n' "$DEVS_OUT" | awk '{print $1}' | grep -qx "$SERIAL"; then
  echo "ERROR: device '$SERIAL' is not attached." >&2
  exit 3
fi
echo "Using device: $SERIAL"

# ---------------------------------------------------------------- 0b. app info
sec "0b. target package"
cmd "getprop ro.build.version.release / ro.build.version.sdk"
REL="$(sh getprop ro.build.version.release)"
SDK="$(sh getprop ro.build.version.sdk)"
echo "Android release=$REL  sdk=$SDK"

cmd "pm list packages | grep inorinal"
PKGS="$(sh pm list packages)"
printf '%s\n' "$PKGS" | grep -i inorinal || echo "(package not installed!)"

cmd "dumpsys package $PKG | grep version"
"$ADB_BIN" -s "$SERIAL" shell dumpsys package "$PKG" 2>&1 \
  | grep -E "versionName|versionCode|firstInstallTime|lastUpdateTime" | head -6

# ---------------------------------------------------------------- helpers
policy_dump() { "$ADB_BIN" -s "$SERIAL" shell dumpsys device_policy 2>&1; }
admins_block() { policy_dump | sed -n '/Enabled Device Admins/,/mPasswordOwner/p'; }
has_admin()    { policy_dump | grep -q "QiDeviceAdminReceiver"; }
owners() {
  # Android 13+ uses "dpm list-owners"; older builds accepted "dpm list owners".
  local out
  out="$(sh dpm list-owners 2>&1)"
  case "$out" in
    *"Unknown command"*) out="$(sh dpm list owners 2>&1)" ;;
  esac
  printf '%s\n' "$out"
}
enabled_admins_setting() { sh settings get secure enabled_device_admins; }

# ---------------------------------------------------------------- check 1
sec "CHECK 1 -- is the qi device admin listed / activatable?"
cmd "dumpsys device_policy  (Enabled Device Admins block)"
BLOCK="$(admins_block)"
printf '%s\n' "$BLOCK"

cmd "settings get secure enabled_device_admins"
EADM="$(enabled_admins_setting)"
echo "$EADM"

cmd "dpm list-owners"
OWN="$(owners)"
echo "$OWN"

cmd "dumpsys package $PKG  (receiver component declared?)"
"$ADB_BIN" -s "$SERIAL" shell dumpsys package "$PKG" 2>&1 \
  | grep -A4 "QiDeviceAdminReceiver" | head -12

if has_admin; then
  V1="PASS  qi device admin is ACTIVE on $SERIAL"
else
  V1="INFO  qi device admin is NOT active (expected before activation)"
fi
echo "-> $V1"

# ---------------------------------------------------------------- check 2
sec "CHECK 2 -- does the app hold what lockNow() requires?"
cmd "dumpsys device_policy | grep QiDeviceAdminReceiver"
if has_admin; then
  echo "admin component present -> DevicePolicyManager.isAdminActive() returns true"
  V2="PASS  lockNow() precondition satisfied (screen must still be locked from inside the app)"
else
  echo "admin component absent -> isAdminActive() returns false"
  V2="INFO  not active -> lockNow() would reject with device_admin_missing"
fi

cmd "dumpsys power | grep mWakefulness"
sh dumpsys power | grep -E "mWakefulness" | head -2

# API 35 has no mShowingLockscreen; isKeyguardShowing + mDreamingLockscreen are the
# fields that actually exist (verified on Android 15 / API 35).
cmd "dumpsys window | grep -E 'isKeyguardShowing|mDreamingLockscreen'"
sh dumpsys window | grep -E "isKeyguardShowing|mDreamingLockscreen" | head -4
echo "-> $V2"

# ---------------------------------------------------------------- check 3
sec "CHECK 3 -- after revoke, does lockNow() return device_admin_missing?"
if has_admin; then
  echo "admin still active -> revoke first (in-app or Settings > Security > Device admin apps)"
  V3="BLOCKED  revoke the admin, then re-run this check"
else
  echo "admin not active -> GuardModule.lockNow() takes the failure branch:"
  echo '  reject("device_admin_missing", "还需要开启设备管理员才能锁定屏幕")'
  ADM_SRC="$REPO_ROOT/react-native/android/app/src/main/java/com/inorinal/qi/GuardModule.kt"
  QID_SRC="$REPO_ROOT/react-native/src/native/QiDevice.ts"
  adm_line="$(grep -n 'device_admin_missing' "$ADM_SRC" 2>/dev/null | head -1 | cut -d: -f1)"
  js_line="$(grep -nE 'lockNow: .*requireGuard' "$QID_SRC" 2>/dev/null | head -1 | cut -d: -f1)"
  echo "  source: GuardModule.kt${adm_line:+:$adm_line} (anchor: device_admin_missing)"
  echo "note: the JS call site is absent in v0.6.2 (QiDevice.ts${js_line:+:$js_line} wraps it only),"
  echo "      so the rejection itself is 待实测 -- see doc section 7 check 3."
  V3="INFO  code path is device_admin_missing; end-to-end call still 待实测"
fi
echo "-> $V3"

# ---------------------------------------------------------------- check 4
sec "CHECK 4 -- after revoke, is the admin gone from the system list?"
cmd "settings get secure enabled_device_admins"
echo "$(enabled_admins_setting)"
cmd "dumpsys device_policy  (Enabled Device Admins block)"
printf '%s\n' "$(admins_block)"
cmd "dumpsys package $PKG | grep -A3 QiDeviceAdminReceiver   (component may stay; activation must not)"
"$ADB_BIN" -s "$SERIAL" shell dumpsys package "$PKG" 2>&1 \
  | grep -A3 "QiDeviceAdminReceiver" | head -8

if has_admin; then
  V4="FAIL  admin still listed -- revoke it before expecting a clean list"
else
  V4="PASS  no qi admin in the system admin list"
fi
echo "-> $V4"

# ---------------------------------------------------------------- current runtime
sec "BONUS -- current keep-alive components (read-only)"
cmd "dumpsys activity services $PKG"
"$ADB_BIN" -s "$SERIAL" shell dumpsys activity services "$PKG" 2>&1 \
  | grep -E "ServiceRecord.*inorinal|isForeground|foregroundId|startRequested|stopIfKilled" | head -20

cmd "dumpsys activity processes | grep -A2 inorinal"
"$ADB_BIN" -s "$SERIAL" shell "dumpsys activity processes | grep -A2 inorinal" 2>&1 | head -10

cmd "dumpsys notification --noredact | grep qi.guard"
sh dumpsys notification --noredact | grep -E "qi\.guard" | head -4

# ---------------------------------------------------------------- summary
sec "SUMMARY"
printf 'device            : %s (Android %s / API %s)\n' "$SERIAL" "$REL" "$SDK"
printf 'admin in list     : %s\n' "$(has_admin && echo yes || echo no)"
printf 'enabled_admins    : %s\n' "$EADM"
printf 'device/profile own: %s\n' "$(printf '%s' "$OWN" | tr '\n' ' ')"
printf 'C1 %s\nC2 %s\nC3 %s\nC4 %s\n' "$V1" "$V2" "$V3" "$V4"
hr
echo "READ-ONLY: no activation, no revocation, no settings change, no install."
echo "Full procedure: docs/react-refactor/v0.6.3-deviceadmin.md"
