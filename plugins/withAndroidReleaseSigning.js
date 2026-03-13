const { createRunOncePlugin, withAppBuildGradle } = require('expo/config-plugins');

const PLUGIN_NAME = 'with-android-release-signing';
const GENERATED_TAG = 'shaykit-release-signing';
const GENERATED_START = `// @generated begin ${GENERATED_TAG}`;
const GENERATED_END = `// @generated end ${GENERATED_TAG}`;

const SIGNING_PROPERTIES_BLOCK = [
  GENERATED_START,
  'def hasShaykitUploadSigning = [',
  '    "SHAYKIT_UPLOAD_STORE_FILE",',
  '    "SHAYKIT_UPLOAD_STORE_PASSWORD",',
  '    "SHAYKIT_UPLOAD_KEY_ALIAS",',
  '    "SHAYKIT_UPLOAD_KEY_PASSWORD",',
  '].every { project.hasProperty(it) }',
  GENERATED_END,
].join('\n');

const DEBUG_SIGNING_BLOCK = [
  "        debug {",
  "            storeFile file('debug.keystore')",
  "            storePassword 'android'",
  "            keyAlias 'androiddebugkey'",
  "            keyPassword 'android'",
  "        }",
].join('\n');

const RELEASE_SIGNING_BLOCK = [
  GENERATED_START,
  '        release {',
  '            if (hasShaykitUploadSigning) {',
  '                storeFile file(SHAYKIT_UPLOAD_STORE_FILE)',
  '                storePassword SHAYKIT_UPLOAD_STORE_PASSWORD',
  '                keyAlias SHAYKIT_UPLOAD_KEY_ALIAS',
  '                keyPassword SHAYKIT_UPLOAD_KEY_PASSWORD',
  '            }',
  '        }',
  GENERATED_END,
].join('\n');

function addSigningPropertiesBlock(src) {
  if (src.includes('def hasShaykitUploadSigning = [')) {
    return src;
  }

  const anchor = "def jscFlavor = 'io.github.react-native-community:jsc-android:2026004.+'";
  if (!src.includes(anchor)) {
    throw new Error('Unable to find the jscFlavor block in android/app/build.gradle.');
  }

  return src.replace(anchor, `${anchor}\n\n${SIGNING_PROPERTIES_BLOCK}`);
}

function addReleaseSigningBlock(src) {
  if (src.includes('storeFile file(SHAYKIT_UPLOAD_STORE_FILE)')) {
    return src;
  }

  if (!src.includes(DEBUG_SIGNING_BLOCK)) {
    throw new Error('Unable to find the debug signing config in android/app/build.gradle.');
  }

  return src.replace(DEBUG_SIGNING_BLOCK, `${DEBUG_SIGNING_BLOCK}\n${RELEASE_SIGNING_BLOCK}`);
}

function updateReleaseBuildType(src) {
  const normalizedLine =
    '            signingConfig hasShaykitUploadSigning ? signingConfigs.release : signingConfigs.debug';
  const existingPattern =
    /^\s*signingConfig hasShaykitUploadSigning \? signingConfigs\.release : signingConfigs\.debug$/m;
  const replacement =
    'signingConfig hasShaykitUploadSigning ? signingConfigs.release : signingConfigs.debug';

  if (existingPattern.test(src)) {
    return src.replace(existingPattern, normalizedLine);
  }

  const target = [
    '        release {',
    '            // Caution! In production, you need to generate your own keystore file.',
    '            // see https://reactnative.dev/docs/signed-apk-android.',
    '            signingConfig signingConfigs.debug',
  ].join('\n');

  if (!src.includes(target)) {
    throw new Error('Unable to find the release signingConfig in android/app/build.gradle.');
  }

  return src.replace(target, `${target.replace('signingConfig signingConfigs.debug', replacement)}`);
}

function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;
    contents = addSigningPropertiesBlock(contents);
    contents = addReleaseSigningBlock(contents);
    contents = updateReleaseBuildType(contents);
    config.modResults.contents = contents;
    return config;
  });
}

module.exports = createRunOncePlugin(
  withAndroidReleaseSigning,
  PLUGIN_NAME,
  '1.0.0'
);
