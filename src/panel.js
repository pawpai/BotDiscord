import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';

const dataDirectory = new URL('../data/', import.meta.url);
const stateFile = new URL('panel.json', dataDirectory);

async function readState() {
  try {
    return JSON.parse(await readFile(stateFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('อ่าน data/panel.json ไม่ได้: ตรวจไฟล์ก่อนเปิดบ็อตใหม่', { cause: error });
  }
}

async function saveState(state) {
  await mkdir(dataDirectory, { recursive: true });
  const temporary = new URL('panel.json.tmp', dataDirectory);
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temporary, stateFile);
}

export async function preparePanel(client, config, storage = { readState, saveState }) {
  const guild = await client.guilds.fetch(config.guildId);
  const channel = await guild.channels.fetch(config.channelId);
  if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    throw new Error('CHANNEL_ID ต้องเป็น ID ห้องข้อความในเซิร์ฟเวอร์ที่ตั้งไว้');
  }
  const botMember = await guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('บ็อตต้องมีสิทธิ์ Manage Roles (จัดการยศ)');
  }
  const channelPermissions = channel.permissionsFor(botMember);
  const needed = {
    ViewChannel: PermissionFlagsBits.ViewChannel,
    SendMessages: PermissionFlagsBits.SendMessages,
    EmbedLinks: PermissionFlagsBits.EmbedLinks,
    ReadMessageHistory: PermissionFlagsBits.ReadMessageHistory,
    AddReactions: PermissionFlagsBits.AddReactions,
  };
  const missing = Object.entries(needed).filter(([, permission]) => !channelPermissions?.has(permission));
  if (missing.length) throw new Error(`บ็อตขาดสิทธิ์ในห้อง: ${missing.map(([name]) => name).join(', ')}`);

  await guild.roles.fetch();
  const lines = [];
  for (const entry of config.roles) {
    const role = guild.roles.cache.get(entry.roleId);
    if (!role || role.id === guild.id || role.managed || !role.editable) {
      throw new Error(`แจกยศ ${entry.label} ไม่ได้: ตรวจ ID และลากยศบ็อตให้สูงกว่ายศที่จะให้`);
    }
    let emoji = entry.emoji;
    if (/^[1-9]\d{16,19}$/.test(entry.key)) {
      const custom = await guild.emojis.fetch(entry.key);
      if (!custom?.available) throw new Error(`ใช้อิโมจิของ ${entry.label} ไม่ได้`);
      emoji = custom.toString();
    }
    lines.push(`${emoji} — **${entry.label}** (<@&${role.id}>)`);
  }
  const instruction = config.removeRoleOnUnreact
    ? 'กดเพื่อรับยศ • เอาอิโมจิออกเพื่อถอดยศ • เลือกได้หลายยศ'
    : 'กดอิโมจิเพื่อรับยศ • เลือกได้หลายยศ';
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(config.title)
    .setDescription([config.description, '', ...lines].join('\n'))
    .setFooter({ text: instruction });
  const payload = { embeds: [embed], allowedMentions: { parse: [] } };

  const state = await storage.readState();
  let message;
  if (state?.guildId === guild.id && state.channelId === channel.id) {
    try {
      message = await channel.messages.fetch(state.messageId);
    } catch (error) {
      if (error.code !== 10008) throw error;
    }
    if (message && message.author.id !== client.user.id) {
      throw new Error('ข้อความใน data/panel.json ไม่ใช่ข้อความของบ็อตนี้');
    }
  }
  if (message) await message.edit(payload);
  else {
    message = await channel.send(payload);
    await storage.saveState({ guildId: guild.id, channelId: channel.id, messageId: message.id });
  }
  for (const entry of config.roles) await message.react(entry.emoji);
  return { guild, message };
}
