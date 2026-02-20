#!/usr/bin/env node
// scripts/release.js — Create a GitHub release with install instructions and SHA256 checksums
//
// Usage:
//   node scripts/release.js "Release title" "## What's New\n- Feature 1\n- Feature 2"
//
// Or interactively — it will prompt if args are missing.
// Requires: gh CLI (https://cli.github.com) authenticated

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const version = pkg.version;
const tag = `v${version}`;
const distDir = path.join(__dirname, '..', 'dist');

// Find installer and portable .exe
const installerName = `POTACAT Setup ${version}.exe`;
const portableName = `POTACAT-${version}-portable.exe`;
const installerPath = path.join(distDir, installerName);
const portablePath = path.join(distDir, portableName);

function sha256(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function main() {
  // Verify artifacts exist
  const assets = [];
  if (fs.existsSync(installerPath)) {
    assets.push({ path: installerPath, name: installerName, hash: sha256(installerPath) });
  } else {
    console.error(`ERROR: Installer not found: ${installerPath}`);
    console.error('Run "npm run dist:win" first.');
    process.exit(1);
  }
  if (fs.existsSync(portablePath)) {
    assets.push({ path: portablePath, name: portableName, hash: sha256(portablePath) });
  }

  // Build title and body
  const title = process.argv[2] || `${tag} beta`;
  const whatsNew = process.argv[3] || '<!-- Add release notes here -->';

  // Build checksums section
  const checksums = assets.map(a => `| \`${a.name}\` | \`${a.hash}\` |`).join('\n');

  const body = `${whatsNew}

---

## Install

1. Download **\`${installerName}\`** below${assets.length > 1 ? ' (or the portable version)' : ''}
2. Run the installer — Windows SmartScreen may show **"Windows protected your PC"**
   - Click **More info** then **Run anyway**
   - This is normal for unsigned open-source apps
3. POTACAT will launch automatically after install

> POTACAT is open source and not code-signed. Windows SmartScreen and Defender
> may flag it on first run. This is expected. You can verify the download using
> the SHA-256 checksum below.

## SHA-256 Checksums

| File | SHA-256 |
|------|---------|
${checksums}

**Full Changelog**: https://github.com/Waffleslop/POTA-CAT/compare/v${getPreviousTag()}...${tag}`;

  // Write body to temp file (avoids shell escaping issues)
  const bodyFile = path.join(distDir, 'release-notes.md');
  fs.writeFileSync(bodyFile, body, 'utf-8');

  console.log(`\nCreating release ${tag}: ${title}`);
  console.log(`Assets: ${assets.map(a => a.name).join(', ')}`);
  console.log(`Checksums:`);
  assets.forEach(a => console.log(`  ${a.name}: ${a.hash}`));
  console.log('');

  // Create release with gh
  const assetArgs = assets.map(a => `"${a.path}"`).join(' ');
  const cmd = `gh release create "${tag}" --title "${title}" --notes-file "${bodyFile}" ${assetArgs}`;

  try {
    console.log(`Running: ${cmd}\n`);
    execSync(cmd, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    console.log(`\nRelease ${tag} created successfully!`);
  } catch (err) {
    console.error('Failed to create release. Check gh auth status.');
    process.exit(1);
  } finally {
    // Clean up temp file
    try { fs.unlinkSync(bodyFile); } catch { /* ignore */ }
  }
}

function getPreviousTag() {
  try {
    const tags = execSync('git tag --sort=-v:refname', { encoding: 'utf-8' }).trim().split('\n');
    // Find the first tag that isn't the current one
    for (const t of tags) {
      if (t.trim() && t.trim() !== tag) return t.trim();
    }
  } catch { /* ignore */ }
  // Fallback: decrement patch
  const parts = version.split('.').map(Number);
  if (parts[2] > 0) parts[2]--;
  else if (parts[1] > 0) { parts[1]--; parts[2] = 0; }
  return `v${parts.join('.')}`;
}

main();
