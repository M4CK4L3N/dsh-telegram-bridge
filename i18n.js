// Minimal runtime i18n for dsh-telegram-bridge.
//
// Every user-facing string in index.js goes through t(). Keys are stable hashes
// derived from the original upstream (Vietnamese) literal, so the catalogue can
// be regenerated mechanically without touching call sites.
//
// Resolution order for a key:
//   1. the selected language (ru by default)
//   2. English
//   3. the original upstream text recorded in the catalogue
//
// A dictionary entry is either a plain string or { text, args } where
// {0}, {1}, ... are positional placeholders for the template expressions.

import { ru } from './locales/ru.js';
import { en } from './locales/en.js';
import { vi } from './locales/vi.js';

export const LOCALES = { ru, en, vi };
export const LANGUAGES = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'vi', label: 'Tiếng Việt' },
];

const DICTS = { ru, en, vi };

let language = 'ru';

export function setLanguage(lang) {
  const next = String(lang || '').trim().toLowerCase();
  // 'auto' means "follow the DSH host"; index.js resolves it to a concrete code.
  if (next === 'auto') { language = 'ru'; return language; }
  language = DICTS[next] ? next : 'ru';
  return language;
}

export function getLanguage() {
  return language;
}

/** Locale tag used for date formatting. */
export function dateLocale() {
  return { ru: 'ru-RU', en: 'en-US', vi: 'vi-VN' }[language] || 'ru-RU';
}

/**
 * Translate a catalogue key.
 * @param {string} key   stable hash key from the catalogue
 * @param {Array}  args  positional values for {0}, {1}, ...
 */
export function t(key, args) {
  const dict = DICTS[language] || ru;
  let entry = dict[key];
  if (entry === undefined) entry = en[key];
  if (entry === undefined) return key;

  let text = typeof entry === 'string' ? entry : entry.text;
  if (args && args.length) {
    text = text.replace(/\{(\d+)\}/g, (m, i) => {
      const v = args[Number(i)];
      return v === undefined || v === null ? '' : String(v);
    });
  }
  return text;
}

/**
 * Translate a language-independent phrase that lives outside the hashed
 * catalogue (hand-written blocks such as the settings schema).
 */
export function phrase(slot) {
  const dict = DICTS[language] || ru;
  const entry = dict[slot] ?? en[slot];
  return typeof entry === 'string' ? entry : (entry?.text ?? slot);
}
