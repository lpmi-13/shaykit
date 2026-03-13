const pkg = require('./package.json');

const APP_VARIANTS = new Set(['development', 'production']);
const DEFAULT_DEVELOPMENT_APPLICATION_ID = 'com.anonymous.shaykit';

const appVariant = process.env.APP_VARIANT ?? 'development';
const appVersion = process.env.APP_VERSION_NAME ?? pkg.version;
const androidVersionCode = Number.parseInt(process.env.ANDROID_VERSION_CODE ?? '1', 10);
const productionApplicationId = process.env.ANDROID_APPLICATION_ID;
const developmentApplicationId =
  process.env.ANDROID_DEVELOPMENT_APPLICATION_ID ?? DEFAULT_DEVELOPMENT_APPLICATION_ID;

if (!APP_VARIANTS.has(appVariant)) {
  throw new Error(
    `APP_VARIANT must be one of ${Array.from(APP_VARIANTS).join(', ')}; received "${appVariant}".`
  );
}

if (!Number.isInteger(androidVersionCode) || androidVersionCode < 1) {
  throw new Error(
    `ANDROID_VERSION_CODE must be a positive integer; received "${process.env.ANDROID_VERSION_CODE}".`
  );
}

if (appVariant === 'production' && !productionApplicationId) {
  throw new Error('ANDROID_APPLICATION_ID must be set when APP_VARIANT=production.');
}

module.exports = {
  expo: {
    name: 'shaykit',
    slug: 'shaykit',
    version: appVersion,
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    ios: {
      supportsTablet: true,
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      package: appVariant === 'production' ? productionApplicationId : developmentApplicationId,
      versionCode: androidVersionCode,
    },
    plugins: [
      ['expo-dev-client', { addGeneratedScheme: appVariant !== 'production' }],
      './plugins/withAndroidDevMenuPreferences',
      './plugins/withAndroidReleaseSigning',
    ],
    web: {
      favicon: './assets/favicon.png',
    },
    extra: {
      appVariant,
    },
  },
};
