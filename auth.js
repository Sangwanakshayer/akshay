import dotenv from "dotenv";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";

dotenv.config();

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

const client = new TelegramClient(
  new StringSession(""),
  apiId,
  apiHash,
  { connectionRetries: 5 }
);

await client.start({
  phoneNumber: async () => await input.text("Phone number: "),
  password: async () => await input.text("2FA password: "),
  phoneCode: async () => await input.text("Telegram OTP: "),
  onError: (err) => console.log(err)
});

console.log("\nSESSION STRING:\n");
console.log(client.session.save());

await client.disconnect();
