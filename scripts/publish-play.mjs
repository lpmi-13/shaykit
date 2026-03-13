import { createReadStream, existsSync } from 'node:fs';
import process from 'node:process';

import { google } from 'googleapis';

const REQUIRED_ENV_VARS = [
  'ANDROID_AAB_PATH',
  'GOOGLE_PLAY_PACKAGE_NAME',
  'GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_PATH',
  'GOOGLE_PLAY_TRACK',
];

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalInteger(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer; received "${value}".`);
  }

  return parsed;
}

function getOptionalFloat(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number; received "${value}".`);
  }

  return parsed;
}

async function main() {
  for (const name of REQUIRED_ENV_VARS) {
    getRequiredEnv(name);
  }

  const aabPath = getRequiredEnv('ANDROID_AAB_PATH');
  const packageName = getRequiredEnv('GOOGLE_PLAY_PACKAGE_NAME');
  const serviceAccountKeyPath = getRequiredEnv('GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_PATH');
  const track = getRequiredEnv('GOOGLE_PLAY_TRACK');
  const releaseStatus = process.env.GOOGLE_PLAY_RELEASE_STATUS ?? 'completed';
  const releaseName = process.env.GOOGLE_PLAY_RELEASE_NAME;
  const inAppUpdatePriority = getOptionalInteger('GOOGLE_PLAY_IN_APP_UPDATE_PRIORITY');
  const userFraction = getOptionalFloat('GOOGLE_PLAY_USER_FRACTION');

  if (!existsSync(aabPath)) {
    throw new Error(`Android App Bundle not found at ${aabPath}`);
  }

  if (!existsSync(serviceAccountKeyPath)) {
    throw new Error(`Google Play service account key not found at ${serviceAccountKeyPath}`);
  }

  if (releaseStatus === 'inProgress' && userFraction === undefined) {
    throw new Error('GOOGLE_PLAY_USER_FRACTION must be set when GOOGLE_PLAY_RELEASE_STATUS=inProgress.');
  }

  google.options({ timeout: 120000 });

  const auth = new google.auth.GoogleAuth({
    keyFile: serviceAccountKeyPath,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const publisher = google.androidpublisher({ version: 'v3', auth });

  const editResponse = await publisher.edits.insert({
    packageName,
    requestBody: {},
  });
  const editId = editResponse.data.id;

  if (!editId) {
    throw new Error('Google Play did not return an edit id.');
  }

  console.log(`Created Google Play edit ${editId} for ${packageName}.`);

  const uploadResponse = await publisher.edits.bundles.upload({
    packageName,
    editId,
    media: {
      mimeType: 'application/octet-stream',
      body: createReadStream(aabPath),
    },
  });
  const versionCode = uploadResponse.data.versionCode;

  if (!versionCode) {
    throw new Error('Google Play did not return a versionCode for the uploaded bundle.');
  }

  const release = {
    status: releaseStatus,
    versionCodes: [String(versionCode)],
  };

  if (releaseName) {
    release.name = releaseName;
  }

  if (inAppUpdatePriority !== undefined) {
    release.inAppUpdatePriority = inAppUpdatePriority;
  }

  if (userFraction !== undefined) {
    release.userFraction = userFraction;
  }

  await publisher.edits.tracks.update({
    packageName,
    editId,
    track,
    requestBody: {
      track,
      releases: [release],
    },
  });

  await publisher.edits.commit({
    packageName,
    editId,
  });

  console.log(`Uploaded versionCode ${versionCode} to the ${track} track with status ${releaseStatus}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
