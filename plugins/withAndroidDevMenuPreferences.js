const { createRunOncePlugin, withMainApplication } = require('expo/config-plugins');

const PLUGIN_NAME = 'with-android-dev-menu-preferences';
const DEV_MENU_PREFS_NAME = 'expo.modules.devmenu.sharedpreferences';
const GENERATED_TAG = 'shaykit-dev-menu-preferences';

function addImport(src, importLine) {
  if (src.includes(importLine)) {
    return src;
  }

  const packageMatch = src.match(/^package .*$/m);
  if (!packageMatch) {
    throw new Error('Unable to find package declaration in MainApplication.');
  }

  const insertAt = packageMatch.index + packageMatch[0].length;
  return `${src.slice(0, insertAt)}\n${importLine}${src.slice(insertAt)}`;
}

function addOnCreateBlock(src) {
  if (src.includes(`@generated begin ${GENERATED_TAG}`)) {
    return src;
  }

  const anchor = '    super.onCreate()';
  const insertion = [
    '    // @generated begin shaykit-dev-menu-preferences',
    '    if (BuildConfig.DEBUG) {',
    `      getSharedPreferences("${DEV_MENU_PREFS_NAME}", Context.MODE_PRIVATE)`,
    '        .edit()',
    '        .putBoolean("motionGestureEnabled", false)',
    '        .putBoolean("touchGestureEnabled", true)',
    '        .putBoolean("showFab", true)',
    '        .apply()',
    '    }',
    '    // @generated end shaykit-dev-menu-preferences',
  ].join('\n');

  if (!src.includes(anchor)) {
    throw new Error('Unable to find MainApplication.onCreate() in MainApplication.');
  }

  return src.replace(anchor, `${anchor}\n${insertion}`);
}

function withAndroidDevMenuPreferences(config) {
  return withMainApplication(config, (config) => {
    if (config.modResults.language !== 'kt') {
      throw new Error(`${PLUGIN_NAME} only supports Kotlin MainApplication files.`);
    }

    let contents = config.modResults.contents;
    contents = addImport(contents, 'import android.content.Context');
    contents = addOnCreateBlock(contents);
    config.modResults.contents = contents;
    return config;
  });
}

module.exports = createRunOncePlugin(
  withAndroidDevMenuPreferences,
  PLUGIN_NAME,
  '1.0.0'
);
