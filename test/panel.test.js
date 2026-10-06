import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { preparePanel } from '../src/panel.js';

function fixture() {
  let state = null;
  let messagesSent = 0;
  let messagesEdited = 0;
  const reactions = [];
  const message = {
    id: 'message', author: { id: 'bot' },
    edit: async () => { messagesEdited++; },
    react: async (emoji) => { reactions.push(emoji); },
  };
  const channel = {
    id: 'channel', type: ChannelType.GuildText,
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => message },
    send: async () => { messagesSent++; return message; },
  };
  const guild = {
    id: 'guild', channels: { fetch: async () => channel },
    members: { fetchMe: async () => ({ permissions: { has: () => true } }) },
    roles: { fetch: async () => {}, cache: new Map([['role', { id: 'role', editable: true, managed: false }]]) },
  };
  const client = { user: { id: 'bot' }, guilds: { fetch: async () => guild } };
  const config = {
    guildId: 'guild', channelId: 'channel', title: 'รับยศ', description: 'เลือกยศ', removeRoleOnUnreact: true,
    roles: [{ key: '✅', emoji: '✅', roleId: 'role', label: 'สมาชิก' }],
  };
  const storage = { readState: async () => state, saveState: async (value) => { state = value; } };
  return { client, config, storage, channel, guild, reactions, sent: () => messagesSent, edited: () => messagesEdited };
}

test('first startup creates a panel and restart reuses it without posting another message', async () => {
  const f = fixture();
  await preparePanel(f.client, f.config, f.storage);
  await preparePanel(f.client, f.config, f.storage);
  assert.equal(f.sent(), 1);
  assert.equal(f.edited(), 1);
  assert.deepEqual(f.reactions, ['✅', '✅']);
});

test('a deleted panel is recreated, but a permission error does not create a duplicate', async () => {
  const f = fixture();
  await preparePanel(f.client, f.config, f.storage);
  f.channel.messages.fetch = async () => { throw Object.assign(new Error('deleted'), { code: 10008 }); };
  await preparePanel(f.client, f.config, f.storage);
  assert.equal(f.sent(), 2);
  f.channel.messages.fetch = async () => { throw Object.assign(new Error('forbidden'), { code: 50013 }); };
  await assert.rejects(preparePanel(f.client, f.config, f.storage), /forbidden/);
  assert.equal(f.sent(), 2);
});

test('role hierarchy and Manage Roles permission are checked before posting', async () => {
  const f = fixture();
  f.guild.roles.cache.get('role').editable = false;
  await assert.rejects(preparePanel(f.client, f.config, f.storage), /สูงกว่า/);
  assert.equal(f.sent(), 0);
  f.guild.roles.cache.get('role').editable = true;
  f.guild.members.fetchMe = async () => ({ permissions: { has: (bit) => bit !== PermissionFlagsBits.ManageRoles } });
  await assert.rejects(preparePanel(f.client, f.config, f.storage), /Manage Roles/);
  assert.equal(f.sent(), 0);
});
