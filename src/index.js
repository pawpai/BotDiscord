import { config as loadEnvironment } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { loadConfig } from './config.js';
import { preparePanel } from './panel.js';
import { createReactionHandler } from './reaction-roles.js';

loadEnvironment({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

function reportError(error) {
  // Avoid printing request details or credentials.
  console.error(`ข้อผิดพลาด: ${error.message}${error.code ? ` (code: ${error.code})` : ''}`);
}

async function main() {
  const config = await loadConfig();
  if (process.argv.includes('--check-config')) {
    console.log('รูปแบบการตั้งค่าถูกต้อง (ยังไม่ได้เชื่อมต่อ Discord หรือตรวจสิทธิ์จริง)');
    return;
  }
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
  });
  let panel = null;
  let guild = null;
  const handleReaction = createReactionHandler({
    config,
    getPanel: () => panel,
    getGuild: () => guild,
    botUserId: () => client.user?.id,
    onError: reportError,
  });
  client.on(Events.MessageReactionAdd, (reaction, user) => { void handleReaction(reaction, user); });
  client.on(Events.MessageReactionRemove, (reaction, user) => { void handleReaction(reaction, user, true); });
  client.on(Events.Error, reportError);
  client.once(Events.ClientReady, async () => {
    try {
      const prepared = await preparePanel(client, config);
      guild = prepared.guild;
      panel = prepared.message;
      console.log(`บ็อต ${client.user.tag} พร้อมรับยศแล้ว`);
      console.log(`ข้อความรับยศ: ${panel.url}`);
      console.log('เปิดหน้าต่างนี้ไว้เพื่อให้บ็อตทำงาน (หยุดด้วย Ctrl+C)');
    } catch (error) {
      reportError(error);
      client.destroy();
      process.exitCode = 1;
    }
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { client.destroy(); });
  }
  await client.login(config.token);
}

main().catch((error) => {
  reportError(error);
  process.exitCode = 1;
});
