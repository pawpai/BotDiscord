import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, emojiKey } from '../src/config.js';
import { createReactionHandler } from '../src/reaction-roles.js';

const guildId = '123456789012345678';
const channelId = '234567890123456789';
const roleId = '345678901234567890';
const baseConfig = {
  title: 'รับยศ', description: 'เลือกยศ', removeRoleOnUnreact: true,
  roles: [{ emoji: '✅', roleId, label: 'สมาชิก' }],
};
const env = { DISCORD_TOKEN: 'test-only', GUILD_ID: guildId, CHANNEL_ID: channelId };

function fixture({ config = validateConfig(baseConfig, env), fetchMember, editable = true } = {}) {
  const changes = [];
  const errors = [];
  const member = { roles: {
    add: async (id) => { changes.push(['add', id]); },
    remove: async (id) => { changes.push(['remove', id]); },
  } };
  const guild = {
    roles: { cache: new Map([[roleId, { editable }]]) },
    members: { fetch: fetchMember ?? (async () => member) },
  };
  const handler = createReactionHandler({
    config, getPanel: () => ({ id: 'panel' }), getGuild: () => guild,
    botUserId: () => 'bot', onError: (error) => errors.push(error),
  });
  const reaction = { message: { id: 'panel', channelId }, emoji: { id: null, name: '✅' } };
  const user = { id: 'member', bot: false };
  return { handler, changes, errors, reaction, user, member };
}

test('configuration reports missing token, IDs, and role IDs before connecting', () => {
  assert.throws(() => validateConfig({ ...baseConfig, roles: [{ emoji: '✅', roleId: 'ใส่_ID', label: 'สมาชิก' }] }, {}),
    (error) => /DISCORD_TOKEN/.test(error.message) && /GUILD_ID/.test(error.message) && /roleId/.test(error.message));
});

test('Unicode variants and custom emoji markup resolve consistently', () => {
  assert.equal(emojiKey('❤️'), emojiKey('❤'));
  assert.equal(emojiKey('<a:hello:123456789012345678>'), guildId);
  for (const emoji of ['✅', '❤️', '👨‍👩‍👧‍👦', '🇹🇭', '1️⃣', `<:custom:${guildId}>`, guildId]) {
    assert.doesNotThrow(() => validateConfig({ ...baseConfig, roles: [{ emoji, roleId, label: 'สมาชิก' }] }, env));
  }
});

test('duplicate Unicode variants or roles are rejected to avoid ambiguous removal', () => {
  assert.throws(() => validateConfig({ ...baseConfig, roles: [
    { emoji: '❤️', roleId, label: 'A' },
    { emoji: '❤', roleId: '456789012345678901', label: 'B' },
  ] }, env), /อิโมจิซ้ำ/);
  assert.throws(() => validateConfig({ ...baseConfig, roles: [
    ...baseConfig.roles, { emoji: '🔔', roleId, label: 'B' },
  ] }, env), /ยศซ้ำ/);
});

test('adding and removing a configured reaction changes only its mapped role', async () => {
  const f = fixture();
  await f.handler(f.reaction, f.user);
  await f.handler(f.reaction, f.user, true);
  assert.deepEqual(f.changes, [['add', roleId], ['remove', roleId]]);
  assert.deepEqual(f.errors, []);
});

test('other messages, other channels, unknown emoji, and bot reactions are ignored', async () => {
  const f = fixture();
  await f.handler({ ...f.reaction, message: { id: 'other', channelId } }, f.user);
  await f.handler({ ...f.reaction, message: { id: 'panel', channelId: 'other' } }, f.user);
  await f.handler({ ...f.reaction, emoji: { id: null, name: '🔔' } }, f.user);
  await f.handler(f.reaction, { id: 'otherbot', bot: true });
  await f.handler(f.reaction, { id: 'bot', partial: true });
  assert.deepEqual(f.changes, []);
});

test('partial reactions and partial users work after a restart', async () => {
  const f = fixture();
  await f.handler({ ...f.reaction, partial: true }, {
    id: 'member', partial: true, fetch: async () => ({ id: 'member', bot: false }),
  }, true);
  assert.deepEqual(f.changes, [['remove', roleId]]);
});

test('custom emoji reactions match the emoji ID, regardless of its name', async () => {
  const customId = '456789012345678901';
  const config = validateConfig({ ...baseConfig, roles: [{ emoji: `<:hello:${customId}>`, roleId, label: 'สมาชิก' }] }, env);
  const f = fixture({ config });
  await f.handler({ ...f.reaction, emoji: { id: customId, name: 'renamed' } }, f.user);
  assert.deepEqual(f.changes, [['add', roleId]]);
});

test('rapid add/remove events are serialized for the same member', async () => {
  const f = fixture();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  f.member.roles.add = async (id) => { await gate; f.changes.push(['add', id]); };
  const add = f.handler(f.reaction, f.user);
  const remove = f.handler(f.reaction, f.user, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.changes, []);
  release();
  await Promise.all([add, remove]);
  assert.deepEqual(f.changes, [['add', roleId], ['remove', roleId]]);
});

test('unreact removal can be disabled', async () => {
  const config = validateConfig({ ...baseConfig, removeRoleOnUnreact: false }, env);
  const f = fixture({ config });
  await f.handler(f.reaction, f.user, true);
  assert.deepEqual(f.changes, []);
});

test('members who leave the server are ignored without an error', async () => {
  const f = fixture({ fetchMember: async () => { throw Object.assign(new Error('Unknown Member'), { code: 10007 }); } });
  await f.handler(f.reaction, f.user);
  assert.deepEqual(f.changes, []);
  assert.deepEqual(f.errors, []);
});

test('missing role permissions are reported without granting a role', async () => {
  const f = fixture({ editable: false });
  await f.handler(f.reaction, f.user);
  assert.deepEqual(f.changes, []);
  assert.match(f.errors[0].message, /Manage Roles/);
});

test('a failed role operation does not stop the next event for that member', async () => {
  const f = fixture();
  f.member.roles.add = async () => { throw new Error('Discord temporarily unavailable'); };
  await f.handler(f.reaction, f.user);
  await f.handler(f.reaction, f.user, true);
  assert.equal(f.errors.length, 1);
  assert.deepEqual(f.changes, [['remove', roleId]]);
});
