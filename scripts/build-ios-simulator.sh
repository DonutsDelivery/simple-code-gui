#!/bin/bash
set -euo pipefail

export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export DONUTCODE_IOS_SIMULATOR=1

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DERIVED_DATA="${DONUTCODE_IOS_DERIVED_DATA:-/tmp/donutcode-ios-arm64}"
SIMULATOR_NAME="${DONUTCODE_IOS_SIMULATOR_NAME:-iPhone 17 Pro}"

cd "$ROOT"
npm run mobile:sync

rm -rf "$DERIVED_DATA"
xcodebuild \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -sdk iphonesimulator \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  EXCLUDED_ARCHS= \
  ARCHS=arm64 \
  ONLY_ACTIVE_ARCH=YES \
  build

APP="$DERIVED_DATA/Build/Products/Debug-iphonesimulator/App.app"
UDID=$(xcrun simctl list devices available | sed -n "s/^[[:space:]]*$SIMULATOR_NAME (\([^)]*\)).*/\1/p" | head -1)
if [ -z "$UDID" ]; then
  echo "Built $APP; no available simulator named $SIMULATOR_NAME was found."
  exit 0
fi

xcrun simctl boot "$UDID" 2>/dev/null || true
open -a Simulator --args -CurrentDeviceUDID "$UDID"
xcrun simctl bootstatus "$UDID" -b
xcrun simctl uninstall "$UDID" com.claudeterminal.app 2>/dev/null || true
xcrun simctl install "$UDID" "$APP"
xcrun simctl launch "$UDID" com.claudeterminal.app

echo "DonutCode built, installed, and launched on $SIMULATOR_NAME ($UDID)."
