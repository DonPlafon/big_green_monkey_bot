import { startCaptcha, memberLeft } from '../lib/captcha.js';
export default async function (update, context) {
  await memberLeft(update);
  await startCaptcha(update, context);
}
