#!/usr/bin/env node
// Register a new interface language for dsh-telegram-bridge.
//
//   node scripts/add-locale.mjs <code> <Label> [date-locale]
//   node scripts/add-locale.mjs de Deutsch de-DE
//
// What it does
//   1. creates locales/<code>.js from the English dictionary (keys copied,
//      values left in English so nothing looks broken before translation);
//   2. registers the dictionary in i18n.js (import, LOCALES, LANGUAGES,
//      DICTS, date locale);
//   3. appends the settings-panel dictionary to client.js;
//   4. adds the option to the panel's language selector;
//   5. verifies every touched file still parses.
//
// The client bundle cannot import the server-side i18n module, so its 32
// strings are duplicated in client.js. That duplication is why this script
// exists: adding a language by hand means remembering four places in two
// files, and a missed one silently falls back to Russian.
//
// Insertions are anchored to structural lines, never to substrings, so the
// script cannot corrupt identifiers the way a blind search/replace would.
// Re-running with the same code is a no-op.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const I18N = join(ROOT, 'i18n.js');
const CLIENT = join(ROOT, 'client.js');
const LOCALES_DIR = join(ROOT, 'locales');

const CODE_RE = /^[a-z]{2}$/;

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function read(p) {
  if (!existsSync(p)) fail(`missing file: ${p}`);
  return readFileSync(p, 'utf8');
}

function write(p, text) {
  writeFileSync(p, text);
}

/** True when the runtime accepts the tag for date formatting. */
function isDateLocaleTag(tag) {
  try {
    new Intl.DateTimeFormat(tag);
    return true;
  } catch {
    return false;
  }
}

const [code, label, dateLoc] = process.argv.slice(2);

if (!code || !label) {
  fail('usage: node scripts/add-locale.mjs <code> <Label> [date-locale]\n' +
       '       node scripts/add-locale.mjs de Deutsch de-DE');
}
if (!CODE_RE.test(code)) {
  fail(`language code must be a 2-letter ISO 639-1 code, lowercase (got "${code}")\n` +
       '       examples: de, fr, es, ja, zh');
}
if (code === 'auto') {
  fail('"auto" is reserved: it means "follow the DSH host locale"');
}

const dateLocaleTag = dateLoc || code;
if (!isDateLocaleTag(dateLocaleTag)) {
  fail(`"${dateLocaleTag}" is not a valid date locale for Intl.DateTimeFormat\n` +
       '       pass one explicitly, e.g.: node scripts/add-locale.mjs de Deutsch de-DE');
}
const localeFile = join(LOCALES_DIR, `${code}.js`);

// ---------------------------------------------------------------- dictionary

function dictionaryKeys() {
  const src = read(join(LOCALES_DIR, 'en.js'));
  return [...src.matchAll(/^  ([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
}

function buildLocaleFile() {
  // Copy the English file, then rename the export and the header line.
  // Using English (not Russian) as the source keeps untranslated entries
  // readable as English instead of leaking Russian into the new language.
  const en = read(join(LOCALES_DIR, 'en.js'));
  const out = en
    .replace(
      /^\/\/ English strings for dsh-telegram-bridge\.$/m,
      `// ${label} strings for dsh-telegram-bridge.\n// Values below are copied from English as placeholders: translate them here.`,
    )
    .replace(/^export const en = \{$/m, `export const ${code} = {`);
  if (!out.includes(`export const ${code} = {`)) {
    fail('could not rewrite the English export name — locales/en.js changed shape');
  }
  return out;
}

// ------------------------------------------------------------------ i18n.js

function patchI18n() {
  let src = read(I18N);
  const before = src;

  if (!src.includes(`import { ${code} } from './locales/${code}.js';`)) {
    // Insert after the last existing locale import.
    const imports = [...src.matchAll(/^import \{ \w+ \} from '\.\/locales\/\w+\.js';$/gm)];
    if (!imports.length) fail('no locale imports found in i18n.js');
    const last = imports[imports.length - 1];
    const at = last.index + last[0].length;
    src = `${src.slice(0, at)}\nimport { ${code} } from './locales/${code}.js';${src.slice(at)}`;
  }

  // LOCALES
  src = src.replace(/^export const LOCALES = \{ ([^}]+) \};$/m, (m, names) => {
    const list = names.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.includes(code)) return m;
    return `export const LOCALES = { ${[...list, code].join(', ')} };`;
  });

  // LANGUAGES: add an entry after the last existing one.
  if (!new RegExp(`\\{ value: '${code}',`).test(src)) {
    const entries = [...src.matchAll(/^  \{ value: '\w+', label: '[^']*' \},$/gm)];
    if (!entries.length) fail('no LANGUAGES entries found in i18n.js');
    const last = entries[entries.length - 1];
    const at = last.index + last[0].length;
    const safeLabel = label.replace(/'/g, "\\'");
    src = `${src.slice(0, at)}\n  { value: '${code}', label: '${safeLabel}' },${src.slice(at)}`;
  }

  // DICTS
  src = src.replace(/^const DICTS = \{ ([^}]+) \};$/m, (m, names) => {
    const list = names.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.includes(code)) return m;
    return `const DICTS = { ${[...list, code].join(', ')} };`;
  });

  // dateLocale(): append `<code>: '<tag>'` to the mapping literal.
  src = src.replace(/return \{ ([\w\s:,'"\/-]+) \}\[language\]/m, (m, pairs) => {
    if (new RegExp(`\\b${code}:`).test(pairs)) return m;
    return `return { ${pairs.trim().replace(/,$/, '')}, ${code}: '${dateLocaleTag}' }[language]`;
  });

  if (src === before) {
    console.log(`i18n.js: already registered (no change)`);
    return false;
  }
  write(I18N, src);
  console.log('i18n.js: registered (import, LOCALES, LANGUAGES, DICTS, dateLocale)');
  return true;
}

// ---------------------------------------------------------------- client.js

function patchClient() {
  let src = read(CLIENT);
  const before = src;

  // 1. Settings-panel dictionary: clone the English block, rename the key.
  if (!new RegExp(`^      ${code}: \\{$`, 'm').test(src)) {
    const enStart = src.indexOf('\n      en: {\n');
    if (enStart === -1) fail('could not find the "en" block in client.js');
    const enEnd = src.indexOf('\n      },\n', enStart);
    if (enEnd === -1) fail('could not find the end of the "en" block in client.js');
    const block = src.slice(enStart + 1, enEnd + '\n      },'.length);
    const renamed = block.replace(/^      en: \{$/m, `      ${code}: {`);

    // Insert right before the STRINGS closing brace.
    const stringsStart = src.indexOf('const STRINGS = {');
    if (stringsStart === -1) fail('could not find "const STRINGS = {" in client.js');
    const stringsEnd = src.indexOf('\n    };\n', stringsStart);
    if (stringsEnd === -1) fail('could not find the end of STRINGS in client.js');
    src = `${src.slice(0, stringsEnd)}\n${renamed}${src.slice(stringsEnd)}`;
  }

  // 2. Selector option: append at the end of the option list. The final
  //    option line also carries the closing paren of h('select', ...), so that
  //    paren must move onto the newly added line.
  //
  //    Example of the line being edited:
  //        h('option', { value: 'vi' }, 'Tiếng Việt')),
  //                                                      ^ own, ^ select
  if (!new RegExp(`h\\('option', \\{ value: '${code}' \\}`).test(src)) {
    // A label may hold any script ("Tiếng Việt") and the third argument may be
    // a dictionary reference (L.langAuto) instead of a string literal.
    const opts = [...src.matchAll(/^[ \t]+h\('option', \{ value: '\w+' \}, (?:'[^']*'|[\w.[\]]+)\)+[,;]?[ \t]*$/gm)];
    if (!opts.length) fail('could not find the language <option> list in client.js');

    const last = opts[opts.length - 1];
    const line = last[0];
    const indent = line.match(/^[ \t]+/)[0];

    // Drop a trailing separator, count the trailing ")", and keep the option's
    // own closing paren with the option while the rest belongs to h('select').
    // The separator itself must survive: it closes the enclosing call's argument.
    const sep = (line.match(/[;,][ \t]*$/) || [''])[0];
    const core = line.slice(0, line.length - sep.length);
    const trailing = (core.match(/\)+$/) || [''])[0].length;
    const selectClosers = Math.max(0, trailing - 1);
    const body = core.slice(0, core.length - selectClosers);

    const safeLabel = label.replace(/'/g, "\\'");
    const replacement =
      `${body},\n` +
      `${indent}h('option', { value: '${code}' }, '${safeLabel}')` +
      `${')'.repeat(selectClosers)}${sep ? ',' : ''}`;

    src = `${src.slice(0, last.index)}${replacement}${src.slice(last.index + line.length)}`;
  }

  if (src === before) {
    console.log('client.js: already registered (no change)');
    return false;
  }
  write(CLIENT, src);
  console.log('client.js: registered (panel dictionary, selector option)');
  return true;
}

// ---------------------------------------------------------------------- run

console.log(`adding language "${code}" (${label}, dates via ${dateLocaleTag})\n`);

if (!existsSync(localeFile)) {
  write(localeFile, buildLocaleFile());
  console.log(`locales/${code}.js: created`);
} else {
  console.log(`locales/${code}.js: exists, left untouched`);
}

const changedI18n = patchI18n();
const changedClient = patchClient();

// Verify every touched file still parses.
const files = [I18N, CLIENT, localeFile, ...readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.js'))
  .map((f) => join(LOCALES_DIR, f))];

let broken = 0;
for (const f of new Set(files)) {
  const res = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (res.status !== 0) {
    broken++;
    console.error(`\nsyntax error in ${f}:\n${res.stderr}`);
  }
}

if (broken) fail(`${broken} file(s) failed the syntax check — inspect the diff before committing`);

const keys = dictionaryKeys();
console.log(`\nsyntax check: all files OK`);
console.log(`locales/${code}.js: ${keys.length} keys, currently English placeholders`);
console.log(`panel dictionary: 32 strings, currently English placeholders`);
console.log(`\nnext: translate locales/${code}.js and the ${code} block in client.js,`);
console.log(`then set "language": "${code}" in the plugin settings (or keep "auto").`);

if (!changedI18n && !changedClient) {
  console.log('\nnothing to do: the language was already registered.');
}
