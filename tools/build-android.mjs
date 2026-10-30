import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, 'build', 'android');
const out = join(work, 'LexiGene-android.apk');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(process.env.HOME || '', 'Android', 'Sdk');
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', cwd: root, ...options });

function newest(parent, prefix) {
  if (!existsSync(parent)) throw new Error(`Missing Android SDK directory: ${parent}`);
  const rank = name => Number((name.match(/\d+/g) || ['0']).reduce((highest, part) => Math.max(highest, Number(part)), 0));
  const candidates = readdirSync(parent).filter(name => name.startsWith(prefix)).sort((a, b) => rank(b) - rank(a) || b.localeCompare(a));
  if (!candidates.length) throw new Error(`Missing Android SDK component ${prefix}* in ${parent}`);
  return join(parent, candidates[0]);
}

const buildTools = process.env.ANDROID_BUILD_TOOLS ? join(sdk, 'build-tools', process.env.ANDROID_BUILD_TOOLS) : newest(join(sdk, 'build-tools'), '');
const platform = process.env.ANDROID_PLATFORM ? join(sdk, 'platforms', process.env.ANDROID_PLATFORM) : newest(join(sdk, 'platforms'), 'android-');
const versionName = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const androidJar = join(platform, 'android.jar');
if (!existsSync(androidJar)) throw new Error(`Missing ${androidJar}`);

const env = { ...process.env, CGO_ENABLED: '0', GOOS: 'linux' };
for (const tool of ['javac', 'python3']) {
  try { execFileSync(tool, ['--version'], { stdio: 'ignore' }); } catch { throw new Error(`Missing required build tool: ${tool}`); }
}

rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, 'gen'), { recursive: true });
mkdirSync(join(work, 'classes'), { recursive: true });
mkdirSync(join(work, 'dex'), { recursive: true });

console.log('Building the web frontend…');
run('npm', ['run', 'build:web']);

const assets = join(work, 'assets');
mkdirSync(join(assets, 'www'), { recursive: true });
cpSync(join(root, 'dist'), join(assets, 'www'), { recursive: true });
mkdirSync(join(assets, 'www', 'licenses'), { recursive: true });
cpSync(join(root, 'LICENSE'), join(assets, 'www', 'licenses', 'MIT.txt'));
cpSync(join(root, 'public', 'fonts', 'ReadingFont-OFL.txt'), join(assets, 'www', 'licenses', 'OFL.txt'));

// The headless tag drops the mygo desktop launcher (and its dynamic libc
// dependency), so Android runs the bundled service as a static executable.
console.log('Building the bundled Go service…');
for (const [abi, goarch] of [['arm64-v8a', 'arm64'], ['x86_64', 'amd64']]) {
  const target = join(work, 'lib', abi, 'liblexigene.so');
  mkdirSync(join(work, 'lib', abi), { recursive: true });
  run('node', ['tools/run-go.mjs', 'build', '-trimpath', '-tags', 'headless', '-ldflags', '-s -w', '-o', target, '.'], { env: { ...env, GOARCH: goarch } });
}

console.log(`Compiling resources with ${buildTools.split('/').pop()}…`);
run(join(buildTools, 'aapt2'), ['compile', '--dir', join(root, 'android', 'res'), '-o', join(work, 'res.zip')]);
run(join(buildTools, 'aapt2'), [
  'link', '-o', join(work, 'base.apk'),
  '-I', androidJar,
  '--manifest', join(root, 'android', 'AndroidManifest.xml'),
  '-A', assets,
  '--java', join(work, 'gen'),
  '--min-sdk-version', '26', '--target-sdk-version', '36',
  '--version-code', process.env.ANDROID_VERSION_CODE || '3',
  '--version-name', versionName,
  join(work, 'res.zip'),
]);

const sources = [];
const collect = directory => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.name.endsWith('.java')) sources.push(path);
  }
};
collect(join(root, 'android', 'src'));
collect(join(work, 'gen'));

console.log('Compiling Java sources…');
writeFileSync(join(work, 'sources.txt'), sources.join('\n'));
execFileSync('javac', ['--release', '17', '-encoding', 'UTF-8', '-classpath', androidJar, '-d', join(work, 'classes'), `@${join(work, 'sources.txt')}`], { stdio: 'inherit', cwd: root });

console.log('Dexing…');
run('jar', ['--create', '--file', join(work, 'classes.jar'), '-C', join(work, 'classes'), '.']);
run(join(buildTools, 'd8'), ['--lib', androidJar, '--min-api', '26', '--output', join(work, 'dex'), join(work, 'classes.jar')]);

// Assemble: base resources + dex + bundled native services, then align and sign.
console.log('Packaging…');
run('python3', [join(root, 'tools', 'assemble_apk.py'), join(work, 'base.apk'), join(work, 'dex', 'classes.dex'), join(work, 'lib'), join(work, 'unsigned.apk')]);
run(join(buildTools, 'zipalign'), ['-f', '4', join(work, 'unsigned.apk'), join(work, 'aligned.apk')]);

const keystore = process.env.ANDROID_KEYSTORE_PATH || join(root, 'artifacts', 'android', 'lexigene.jks');
const password = process.env.ANDROID_KEYSTORE_PASSWORD || 'lexigene';
if (process.env.ANDROID_KEYSTORE_BASE64 && process.env.ANDROID_KEYSTORE_PATH) {
  mkdirSync(join(root, 'artifacts', 'android'), { recursive: true });
  writeFileSync(keystore, Buffer.from(process.env.ANDROID_KEYSTORE_BASE64, 'base64'));
}
if (!existsSync(keystore)) {
  mkdirSync(join(keystore, '..'), { recursive: true });
  const keytool = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', 'keytool') : 'keytool';
  execFileSync(keytool, ['-genkeypair', '-keystore', keystore, '-storepass', password, '-keypass', password, '-alias', 'lexigene',
    '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=LexiGene, OU=Release, O=LexiGene, C=CN'], { stdio: 'inherit' });
}
run(join(buildTools, 'apksigner'), ['sign', '--ks', keystore, '--ks-pass', `pass:${password}`, '--key-pass', `pass:${password}`, '--out', out, join(work, 'aligned.apk')]);
run(join(buildTools, 'apksigner'), ['verify', '--print-certs', out]);
run('python3', [join(root, 'tools', 'verify_apk.py'), out]);

const size = statSync(out).size;
console.log(`\nAPK: ${relative(root, out)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
