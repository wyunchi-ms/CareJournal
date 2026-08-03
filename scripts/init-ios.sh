#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "CareJournal iOS initialization requires macOS with Xcode." >&2
  exit 1
fi
command -v xcodebuild >/dev/null || { echo "Xcode command line tools are missing." >&2; exit 1; }
npm install
npm run build
if [[ ! -d ios ]]; then
  npx cap add ios
fi
npx cap sync ios
echo "Open ios/App/App.xcworkspace in Xcode, configure Team and signing, then Archive for distribution."
