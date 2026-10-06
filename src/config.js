import { readFile } from 'node:fs/promises';

const snowflake = /^[1-9]\d{16,19}$/;
const customEmoji = /^<a?:[A-Za-z0-9_]+:([1-9]\d{16,19})>$/;
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function emojiKey(emoji) {
  const value = String(emoji).trim();
  return customEmoji.exec(value)?.[1] ?? value.replace(/\uFE0F/g, '');
}

export function validateConfig(raw, env) {
  const errors = [];
  if (!env.DISCORD_TOKEN?.trim()) errors.push('เติม DISCORD_TOKEN ใน .env');
  for (const key of ['GUILD_ID', 'CHANNEL_ID']) {
    if (!snowflake.test(env[key] ?? '')) errors.push(`เติม ${key} เป็น ID ตัวเลขใน .env`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('config.json ต้องเป็นออบเจ็กต์ JSON');
  }
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 256) {
    errors.push('title ต้องเป็นข้อความยาว 1–256 ตัวอักษร');
  }
  if (typeof raw.description !== 'string' || raw.description.length > 1000) {
    errors.push('description ต้องเป็นข้อความไม่เกิน 1,000 ตัวอักษร');
  }
  if (typeof raw.removeRoleOnUnreact !== 'boolean') {
    errors.push('removeRoleOnUnreact ต้องเป็น true หรือ false');
  }
  if (!Array.isArray(raw.roles) || raw.roles.length < 1 || raw.roles.length > 20) {
    errors.push('roles ต้องมี 1–20 รายการ');
  }
  const seenEmojis = new Set();
  const seenRoles = new Set();
  for (const [index, entry] of (Array.isArray(raw.roles) ? raw.roles : []).entries()) {
    const prefix = `roles รายการที่ ${index + 1}`;
    if (!entry || typeof entry !== 'object') {
      errors.push(`${prefix} ต้องเป็นออบเจ็กต์`);
      continue;
    }
    const emoji = typeof entry.emoji === 'string' ? entry.emoji.trim() : '';
    const isUnicodeEmoji = [...segmenter.segment(emoji)].length === 1
      && /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/u.test(emoji);
    if (!customEmoji.test(emoji) && !snowflake.test(emoji) && !isUnicodeEmoji) {
      errors.push(`${prefix}: emoji ต้องเป็นอิโมจิหนึ่งตัว, <:ชื่อ:ID> หรือ ID อิโมจิ`);
    }
    const key = emojiKey(emoji);
    if (seenEmojis.has(key)) errors.push(`${prefix}: อิโมจิซ้ำ`);
    seenEmojis.add(key);
    if (!snowflake.test(entry.roleId ?? '')) errors.push(`${prefix}: เติม roleId เป็น ID ยศตัวเลข`);
    if (seenRoles.has(entry.roleId)) errors.push(`${prefix}: ยศซ้ำ (ใช้หนึ่งอิโมจิต่อหนึ่งยศ)`);
    seenRoles.add(entry.roleId);
    if (typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 100) {
      errors.push(`${prefix}: label ต้องเป็นข้อความยาว 1–100 ตัวอักษร`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return {
    ...raw,
    token: env.DISCORD_TOKEN.trim(),
    guildId: env.GUILD_ID,
    channelId: env.CHANNEL_ID,
    roles: raw.roles.map((entry) => ({ ...entry, emoji: entry.emoji.trim(), key: emojiKey(entry.emoji) })),
  };
}

export async function loadConfig(env = process.env) {
  const text = await readFile(new URL('../config.json', import.meta.url), 'utf8');
  return validateConfig(JSON.parse(text.replace(/^\uFEFF/, '')), env);
}
