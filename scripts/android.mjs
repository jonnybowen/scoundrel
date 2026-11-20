#!/usr/bin/env node
/**
 * Android helper for the Capacitor shell (android/). Assumes `vite build` already produced dist/.
 *
 *   node scripts/android.mjs build    cap sync + gradle assembleDebug -> android/app/build/outputs/apk/debug/app-debug.apk
 *   node scripts/android.mjs install  adb install -r the debug APK
 *   node scripts/android.mjs launch   start the app on the device
 *   node scripts/android.mjs run      build + install + launch
 *   node scripts/android.mjs log      logcat filtered to the WebView console / Capacitor / crashes
 *
 * Environment is resolved per process, never persisted: JAVA_HOME falls back to Android Studio's bundled JBR,
 * ANDROID_HOME to the default SDK location. Set ANDROID_SERIAL to pick a device when several are attached.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const win = platform() === 'win32';
const APP_ID = 'com.scoundrel.game';
const APK = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

function firstExisting(...paths) {
  return paths.find((p) => p && existsSync(p));
}

const env = { ...process.env };
env.JAVA_HOME ||= firstExisting(
  win ? 'C:\\Program Files\\Android\\Android Studio\\jbr' : undefined,
  platform() === 'darwin' ? '/Applications/Android Studio.app/Contents/jbr/Contents/Home' : undefined,
  '/opt/android-studio/jbr',
);
env.ANDROID_HOME ||=
  env.ANDROID_SDK_ROOT ||
  firstExisting(
    win && env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Android', 'Sdk') : undefined,
    join(homedir(), 'Library', 'Android', 'sdk'),
    join(homedir(), 'Android', 'Sdk'),
  );
if (!env.JAVA_HOME || !env.ANDROID_HOME) {
  console.error(`android: need JAVA_HOME (${env.JAVA_HOME ?? 'unset'}) and ANDROID_HOME (${env.ANDROID_HOME ?? 'unset'})`);
  process.exit(1);
}
const sep = win ? ';' : ':';
env.PATH = [join(env.JAVA_HOME, 'bin'), join(env.ANDROID_HOME, 'platform-tools'), env.PATH ?? env.Path].join(sep);
if (win) delete env.Path; // avoid two PATH keys fighting on Windows
const adb = join(env.ANDROID_HOME, 'platform-tools', win ? 'adb.exe' : 'adb');

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', env, cwd: root, shell: win, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const steps = {
  build() {
    if (!existsSync(join(root, 'dist', 'index.html'))) {
      console.error('android: dist/ missing; run `vite build` first (npm run android:build does this).');
      process.exit(1);
    }
    run('npx', ['cap', 'sync', 'android']);
    const android = join(root, 'android');
    run(join(android, win ? 'gradlew.bat' : 'gradlew'), ['assembleDebug', '--console=plain'], { cwd: android });
    console.log(`APK: ${APK}`);
  },
  install() {
    run(adb, ['install', '-r', APK], { shell: false });
  },
  launch() {
    run(adb, ['shell', 'am', 'start', '-n', `${APP_ID}/.MainActivity`], { shell: false });
  },
  run() {
    steps.build();
    steps.install();
    steps.launch();
  },
  log() {
    run(adb, ['logcat', '-v', 'time', 'Capacitor:V', 'Capacitor/Console:V', 'chromium:V', 'AndroidRuntime:E', '*:S'], {
      shell: false,
    });
  },
};

const step = process.argv[2];
if (!step || !(step in steps)) {
  console.error(`usage: node scripts/android.mjs <${Object.keys(steps).join('|')}>`);
  process.exit(1);
}
steps[step]();
