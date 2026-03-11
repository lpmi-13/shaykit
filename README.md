# ShayKit

A React Native app for practicing English word stress patterns by physically shaking your device. Built with Expo.

## How It Works

1. Press **Start** on the splash screen
2. A two-syllable word appears with its stress pattern shown as dots:
   - **●** (filled) = stressed syllable — shake HARD
   - **○** (empty) = unstressed syllable — shake gently
3. Start shaking your phone to begin. The app listens for each syllable in sequence:
   - For **stressed** syllables: shake forcefully (acceleration > 4.5g)
   - For **unstressed** syllables: shake gently (acceleration between 1.8g and 4.0g)
4. **Green ✓** = you matched the pattern correctly (auto-advances after 2s)
5. **Red ✗** = try again with the same word (resets after 2s)
6. Use the **Skip →** button to move to the next word at any time

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [Expo Go](https://expo.dev/go) app installed on your Android phone
- Your computer and phone on the same Wi-Fi network

## Setup & Run

```bash
# Clone the repo
git clone https://github.com/lpmi-13/shaykit.git
cd shaykit

# Install dependencies
npm install

# Start the Expo dev server
npx expo start
```

A QR code will appear in the terminal. Scan it with the Expo Go app on your Android device.

> **Note:** The accelerometer requires a physical device — it won't work in an emulator.

## Word List

Uses 258 two-syllable words from the [Academic Word List (AWL)](https://github.com/lpmi-13/machine_readable_wordlists/blob/master/Academic/AWL/AWL.yml) with stress patterns sourced from the [CMU Pronunciation Dictionary](https://github.com/cmusphinx/cmudict).

## Tech Stack

- React Native with Expo
- `expo-sensors` (Accelerometer API)
