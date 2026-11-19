#!/usr/bin/env node
/**
 * Packages the extension into dist/open-link-v<version>.zip for a GitHub Release.
 *
 * - Ships only runtime files (no tests, docs, package.json, or Chrome's _metadata cache).
 * - Fails if manifest.json and package.json versions disagree, or if any file the
 *   manifest or service worker references is missing from the package.
 * - Writes the zip with Node's built-in zlib, so no npm dependencies are needed.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Everything the browser needs at runtime. Directories are included recursively.
const INCLUDE = [
  'manifest.json',
  'background.js',
  'rules.json',
  'LICENSE',
  'lib',
  'content',
  'popup',
  'icons'
];

function fail(message) {
  console.error(`build: ${message}`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
  } catch (err) {
    fail(`cannot parse ${path}: ${err.message}`);
  }
}

function collectFiles(entry) {
  const abs = join(ROOT, entry);
  if (!existsSync(abs)) fail(`missing ${entry}`);
  if (statSync(abs).isFile()) return [entry];
  return readdirSync(abs)
    .flatMap((name) => collectFiles(join(entry, name)))
    .map((p) => p.split(sep).join('/'));
}

// Every file path the manifest and service worker point at (the service worker
// imports lib/ scripts and registers the content/ scripts at runtime).
function referencedFiles(manifest) {
  const refs = new Set();
  Object.values(manifest.icons || {}).forEach((p) => refs.add(p));
  Object.values(manifest.action?.default_icon || {}).forEach((p) => refs.add(p));
  if (manifest.action?.default_popup) refs.add(manifest.action.default_popup);
  for (const cs of manifest.content_scripts || []) {
    [...(cs.js || []), ...(cs.css || [])].forEach((p) => refs.add(p));
  }
  for (const rs of manifest.declarative_net_request?.rule_resources || []) refs.add(rs.path);

  const worker = manifest.background?.service_worker;
  if (worker) {
    refs.add(worker);
    const source = readFileSync(join(ROOT, worker), 'utf8');
    for (const lit of source.matchAll(/['"]((?:lib|content)\/[^'"]+\.(?:js|css))['"]/g)) refs.add(lit[1]);
  }
  return refs;
}

// --- Minimal ZIP writer (PKZIP 2.0, deflate or store, UTF-8 names) ---------------

// Fixed timestamp (1980-01-01 00:00) so the same sources produce the same zip bytes.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);              // version needed
    local.writeUInt16LE(0x0800, 6);          // flags: UTF-8 file names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);              // extra field length

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);            // version made by
    central.writeUInt16LE(20, 6);            // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    // extra len, comment len, disk start, internal attrs, external attrs: all 0
    central.writeUInt32LE(offset, 42);

    localParts.push(local, nameBuf, body);
    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDir, end]);
}

// --- Main --------------------------------------------------------------------------

const manifest = readJson('manifest.json');
const pkg = readJson('package.json');
readJson(manifest.declarative_net_request?.rule_resources?.[0]?.path || 'rules.json');

if (manifest.version !== pkg.version) {
  fail(`version mismatch: manifest.json ${manifest.version} vs package.json ${pkg.version}`);
}

const paths = [...new Set(INCLUDE.flatMap(collectFiles))].sort();
const packaged = new Set(paths);
const missing = [...referencedFiles(manifest)].filter((p) => !packaged.has(p));
if (missing.length) fail(`referenced but not packaged: ${missing.join(', ')}`);

const zip = buildZip(paths.map((name) => ({ name, data: readFileSync(join(ROOT, name)) })));
const outDir = join(ROOT, 'dist');
const outFile = join(outDir, `open-link-v${manifest.version}.zip`);
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, zip);

const sha256 = createHash('sha256').update(zip).digest('hex');
console.log(`Packaged ${paths.length} files -> ${relative(ROOT, outFile)} (${(zip.length / 1024).toFixed(1)} KB)`);
console.log(`SHA-256 ${sha256}`);
