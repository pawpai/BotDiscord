import { emojiKey } from './config.js';

// Serialize changes per member so a quick add/remove finishes in the received order.
export function createReactionHandler({ config, getPanel, getGuild, botUserId, onError = console.error }) {
  const queues = new Map();
  const mappings = new Map(config.roles.map((entry) => [entry.key, entry]));

  return async function handleReaction(reaction, user, remove = false) {
    const panel = getPanel();
    if (!panel || reaction.message.id !== panel.id
      || reaction.message.channelId !== config.channelId
      || user.bot || user.id === botUserId()
      || (remove && !config.removeRoleOnUnreact)) return;
    const entry = mappings.get(reaction.emoji.id ?? emojiKey(reaction.emoji.name));
    if (!entry) return;

    const task = (queues.get(user.id) ?? Promise.resolve()).then(async () => {
      const fullUser = user.partial ? await user.fetch() : user;
      if (fullUser.bot) return;
      const guild = getGuild();
      const role = guild.roles.cache.get(entry.roleId);
      if (!role?.editable) {
        throw new Error(`จัดการยศ ${entry.label} ไม่ได้: ตรวจสิทธิ์ Manage Roles และลำดับยศบ็อต`);
      }
      let member;
      try {
        member = await guild.members.fetch(user.id);
      } catch (error) {
        if (error.code === 10007) return; // The member has left the server.
        throw error;
      }
      const reason = `Reaction role: ${entry.label}`;
      // Single-role endpoints preserve other roles, even if another admin edits them.
      if (remove) await member.roles.remove(entry.roleId, reason);
      else await member.roles.add(entry.roleId, reason);
      console.log(`${remove ? 'ถอด' : 'ให้'}ยศ ${entry.label} แก่สมาชิก ${user.id}`);
    }).catch((error) => onError(error, { userId: user.id, roleId: entry.roleId }));

    queues.set(user.id, task);
    await task;
    if (queues.get(user.id) === task) queues.delete(user.id);
  };
}
