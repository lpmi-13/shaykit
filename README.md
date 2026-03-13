# ShayKit

A React Native app for practicing English word stress patterns in two modes: a tap-to-identify mode and a shake-to-produce mode. Built with Expo.

## Modes

### Feel It

1. Tap **feel it** on the splash screen
2. A target stress pattern is shown as two dots
3. Four words appear in a full-screen 2x2 grid
4. Tap the word that matches the shown pattern
5. If a word has multiple stress patterns by word class, the grid tile includes a small label such as `NOUN` or `VERB`
6. **Green ✓** = correct
7. **Red ✗** = incorrect, then try the same grid again
8. Use **Skip →** to get a new grid, or **Back** to return to the splash screen

### Make It

1. Tap **make it** on the splash screen
2. A two-syllable word appears with two neutral timing dots underneath, placed at 25% and 75% of the word width
3. A karaoke-style timing line sweeps smoothly across the word without stopping
4. Shake when the line passes each dot. The two cue moments are about one second apart:
   - For **stressed** syllables: shake forcefully (acceleration > 3.0g)
   - For **unstressed** syllables: shake gently (acceleration from 1.0g up to but not including 3.0g)
5. The dots stay neutral, so the UI does not reveal the expected stress pattern
6. The phone gives discrete haptic feedback when it detects a gentle or hard shake
7. In development builds, a small debug readout at the top shows the live g-force and the last detected weak or hard shake
8. **Green ✓** = correct
9. **Red ✗** = incorrect, then the same word is replayed
10. Use **Skip →** to get a new word, or **Back** to return to the splash screen

## Prerequisites

- [Node.js](https://nodejs.org/) (v20 or later)
- Java 17
- Android Studio with the Android SDK and platform-tools installed
- An Android phone with USB debugging enabled
- A USB cable for the first install
- The phone and computer on the same Wi-Fi network if you want wireless debugging

> **Why not Expo Go?** Expo Go reserves the shake gesture for its developer menu, so this app is best tested with an Android development build.

## First-Time Setup

```bash
# Clone the repo
git clone https://github.com/lpmi-13/shaykit.git
cd shaykit

# Install dependencies
npm install

# Confirm your phone is visible to adb
adb devices

# Build and install the Android development build on your phone
npm run android:device
```

The first Android build will:

- generate the local `android/` project (it is gitignored)
- compile a debug build with `expo-dev-client`
- install the app on your phone

## Optional: Enable Wireless Debugging

After the first USB install, you can switch to wireless debugging on Android 11 or later:

1. Keep the phone connected over USB for the first setup
2. On the phone, open **Developer options**
3. Turn on **USB debugging**
4. Turn on **Wireless debugging**
5. Open **Wireless debugging** and choose **Pair device with pairing code**
6. On your computer, run `adb pair PHONE_IP:PAIRING_PORT` using the address shown on the phone
7. Enter the pairing code shown on the phone
8. Run `adb connect PHONE_IP:DEBUG_PORT` using the connection address shown on the phone
9. Confirm the device appears in `adb devices`

After that, you can disconnect the cable and keep using:

```bash
npm run start:dev
```

If the wireless connection drops, reconnect with `adb connect PHONE_IP:DEBUG_PORT` or pair again from the phone's **Wireless debugging** screen.

## Dev-Menu Gesture Defaults

This project now configures Android development builds to:

- turn **Shake device** off
- leave **3 fingers long press** on
- turn the floating **Tools button** on

That leaves the physical shake gesture available for gameplay while keeping the developer menu accessible.

If you already installed an older development build, reinstall it once so the new native setting takes effect:

```bash
npm run android:device
```

## Daily Development Loop

For normal JS changes, you do not need to rebuild the native app.

```bash
# Start Metro for the installed development build
npm run start:dev
```

Then open the installed ShayKit app on your phone and connect it to the running dev server.

Use one of these instead of shaking to open developer tools:

- Press `m` in the Expo terminal while the phone is connected over ADB
- Use **3 fingers long press**
- Use the floating **Tools button**

## Rebuild When Native Code Changes

If you add or remove native dependencies, or change native configuration, rebuild the app:

```bash
npm run android:device
```

If you want to target an emulator instead of a physical device, use:

```bash
npm run android
```

> **Note:** The accelerometer requires a physical device for real shake testing. An emulator is still useful for layout and non-motion UI work.

## Google Play Automation

This repo now includes a self-managed Google Play release pipeline in `.github/workflows/android-release.yml`.

- pushes to `main` target the Play `internal` track
- tag pushes target the Play `production` track
- production tags must match the app version in `package.json` as either `1.2.3` or `v1.2.3`
- the workflow is dormant until the `PLAY_AUTOMATION_ENABLED` repository variable is set to `true`

The release build stays in Expo's generated-native model:

- `app.config.js` drives the Android package id and `versionCode` from CI environment variables
- `plugins/withAndroidReleaseSigning.js` patches Expo's generated `android/app/build.gradle` so Gradle can read upload-key properties from CI
- `scripts/publish-play.mjs` uploads the finished `.aab` directly to the Google Play Developer API

### Required GitHub configuration

Repository variables:

- `PLAY_AUTOMATION_ENABLED` set to `true` only after Play Console setup is complete
- `ANDROID_APPLICATION_ID` set to the final Play package name, for example `com.yourcompany.shaykit`

Repository secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`

### Required Play Console setup

Before enabling the workflow, complete these manual steps in Google Play:

1. Create the Play app with the same package name as `ANDROID_APPLICATION_ID`.
2. Enable the Google Play Developer API for your Google Cloud project.
3. Create a service account, then grant it Play Console access for this app.
4. Finish the Play listing, content rating, data safety, and tester configuration.
5. Upload the first release manually in Play Console once. The publishing API only works against an existing app record.

After those steps are done, set `PLAY_AUTOMATION_ENABLED=true`. The next push to `main` will build a signed Android App Bundle and publish it to the `internal` track. The next tag push will publish to `production`.

### Local release dry run

If you want to build the same type of release bundle locally without publishing it:

```bash
APP_VARIANT=production \
ANDROID_APPLICATION_ID=com.example.shaykit \
ANDROID_VERSION_CODE=123 \
npm run android:bundle:release
```

## Word List

Uses 258 two-syllable words from the [Academic Word List (AWL)](https://github.com/lpmi-13/machine_readable_wordlists/blob/master/Academic/AWL/AWL.yml) with stress patterns sourced from the [CMU Pronunciation Dictionary](https://github.com/cmusphinx/cmudict).

The tap grid also includes a small set of annotated noun/verb alternations, based on CMUdict entries that flip stress between first and second syllables, so tiles like `conduct` or `project` can be shown as distinct `NOUN` and `VERB` choices.

## Tech Stack

- React Native with Expo
- `expo-dev-client` for Android development builds
- GitHub Actions + Google Play Developer API for Android release automation
- `expo-haptics` for discrete weak/strong vibration feedback
- `expo-sensors` (Accelerometer API)
