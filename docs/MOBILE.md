# Gather mobile builds

The Capacitor projects package the same React receipt workspace for Android and iOS. The app bundles the web files locally. Manual entry, pasted receipt text, the Costco demo, and bill splitting can run offline. Photos and PDFs can be prepared locally. The phone’s clipboard and share sheet handle split summaries.

This branch uses the tested website as its starting point. The standalone browser build continues to use the site’s same-origin receipt API. The native preview has its offline workspace available immediately and needs a separately configured backend connection for live OpenAI scans. Its configuration ships with a local web bundle and without a remote server URL or service credentials.

## Android on Windows

Install Node.js 22 or later with the minimum version in package.json. Use Android Studio 2025.2.1 or later, or the Android SDK command-line tools and JDK 21 for a command-line build. Install the Android API 36 SDK and its build tools. The app’s minimum device API is 24. [Capacitor environment setup](https://capacitorjs.com/docs/getting-started/environment-setup)

```powershell
npm ci
npm run mobile:sync:android
Set-Location android
.\gradlew.bat assembleDebug
```

The debug APK is created at `android/app/build/outputs/apk/debug/app-debug.apk` from the repo root. Use an Android device or emulator with USB debugging and `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` from the repo root. Run `npx cap open android` from the root to open the project in Android Studio.

## iPhone on macOS

Use Xcode 26 or later with its command-line tools. The iOS project uses Swift Package Manager. Open it, select a signing team and choose a connected iPhone or a simulator. The same source files and receipt rules are shared by both apps. [Capacitor iOS setup](https://capacitorjs.com/docs/ios) · [Swift Package Manager](https://capacitorjs.com/docs/ios/spm)

```sh
npm ci
npm run mobile:sync:ios
npx cap open ios
```

## iPhone from Windows

Push an `iphone-test-*` tag pointing to a Capacitor commit to run **Build Gather for iPhone** on GitHub's macOS runner. It compiles the device app with Xcode and uploads an unsigned IPA plus its SHA-256 checksum. Download and unzip `gather-iphone-unsigned` from the run's Artifacts section. Standard hosted runners are free for public repositories. [Runner images](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) · [GitHub Actions billing](https://docs.github.com/en/actions/concepts/billing-and-usage)

For a personal test with a free Apple Account, set up AltServer from its official Windows guide and connect your unlocked iPhone by USB. Hold Shift while clicking the AltServer tray icon, choose **Sideload .ipa…**, and select the iPhone and `Gather-iPhone-unsigned.ipa`. Enter Apple sign-in details in AltServer. Follow the iPhone prompts to trust the development app and enable Developer Mode if required. The development signature lasts seven days. [AltServer for Windows](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows) · [Direct IPA installation](https://faq.altstore.io/release-notes/altserver) · [Apple Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)

TestFlight is Apple's distribution option for repeated testing and requires an Apple Developer Program membership and a signed upload. [Apple beta distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases/)

## Oracle and the backend

Oracle Cloud is an option for running the Gather website and HTTPS Node API when the PC is off. A small VM can also run a persistent PostgreSQL database if account storage is added to the deployed build. Capacitor creates the phone apps locally. To enable native scanning later, connect the signed app to the approved HTTPS API with its access controls and scan allowance. The operator keeps the OpenAI key on the server. Oracle’s current Always Free eligibility and available capacity depend on the account’s home region. Receipt scans use the operator’s OpenAI project credits. [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

## Check on a device

Open Gather offline, load the Costco demo, verify £176.78, then make a manual receipt and split it. Reopen the app to check the draft. Try the camera and photo/PDF picker, and test both Copy and Share. The native test uses a simulated Capacitor bridge for clipboard and sharing. A signed device run is useful for checking the actual OS permissions, share sheet and screen insets.
