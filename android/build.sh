#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${ANDROID_PLATFORM:?Set Android platform directory}"
: "${ANDROID_BUILD_TOOLS:?Set Android build-tools directory}"
: "${BACKEND_URL:?Set the company account backend HTTPS URL}"
: "${SIGNING_DIR:?Set directory holding the retained mailroom.p12 and password.txt}"
: "${JAVAC_BIN:=javac}"
: "${JAVA_RUNTIME_HOME:=/usr/lib/jvm/java-17-openjdk-amd64}"
python3 - <<'PYASSETS'
from pathlib import Path
import shutil
source=Path('../dist');assert (source/'index.html').is_file(),'Run npm run build first'
root=Path('assets/web');shutil.rmtree(root,ignore_errors=True);shutil.copytree(source,root)
shutil.copy('native.js',root/'native.js')
p=root/'index.html';p.write_text(p.read_text().replace('<head>','<head><script src="/native.js"></script>'))
PYASSETS
mkdir -p build/classes build/dex build/gen/com/mailroom/company
python3 - <<'PY'
import os,pathlib,json,urllib.parse
u=os.environ['BACKEND_URL'];p=urllib.parse.urlsplit(u)
assert p.scheme=='https' and p.hostname and not p.username and not p.password and not p.query and not p.fragment ,'Expected an HTTPS origin'
pathlib.Path('build/gen/com/mailroom/company/BuildConfig.java').write_text('package com.mailroom.company; final class BuildConfig { static final String BACKEND_URL = '+json.dumps(u.rstrip('/'))+'; }')
PY
"$ANDROID_BUILD_TOOLS/aapt" package -f -M AndroidManifest.xml -S res -A assets -I "$ANDROID_PLATFORM/android.jar" -F build/resources.apk -J build/gen
"$JAVAC_BIN" -J-Djava.home="$JAVA_RUNTIME_HOME" -encoding UTF-8 -source 8 -target 8 -bootclasspath "$ANDROID_PLATFORM/android.jar:$ANDROID_BUILD_TOOLS/core-lambda-stubs.jar" -d build/classes src/com/mailroom/company/MainActivity.java build/gen/com/mailroom/company/BuildConfig.java
"$ANDROID_BUILD_TOOLS/d8" --min-api 23 --lib "$ANDROID_PLATFORM/android.jar" --output build/dex build/classes/com/mailroom/company/*.class
cp build/resources.apk build/unsigned.apk
(cd build/dex && zip -q -u ../unsigned.apk classes.dex)
"$ANDROID_BUILD_TOOLS/zipalign" -f 4 build/unsigned.apk build/aligned.apk
export MAILROOM_SIGNING_PASSWORD="$(cat "$SIGNING_DIR/password.txt")"
"$ANDROID_BUILD_TOOLS/apksigner" sign --ks "$SIGNING_DIR/mailroom.p12" --ks-key-alias mailroom --ks-pass env:MAILROOM_SIGNING_PASSWORD --key-pass env:MAILROOM_SIGNING_PASSWORD --out build/Mailroom-2.0.0.apk build/aligned.apk
"$ANDROID_BUILD_TOOLS/apksigner" verify --verbose build/Mailroom-2.0.0.apk
unset MAILROOM_SIGNING_PASSWORD
