export const now = () => Math.floor(Date.now() / 1000);
export const lower = value => String(value ?? '').toLocaleLowerCase('ru');
export const escapeHtml = value => String(value ?? '').replace(/[&<>\"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const displayName = user => lower(user.first_name || user.username || 'участник').slice(0,80);
export const memberKey = (chatId, userId) => `${chatId}:${userId}`;
export const isAdmin = member => ['creator', 'administrator'].includes(member?.status);
export const isMember = member => ['creator', 'administrator', 'member'].includes(member?.status)
  || (member?.status === 'restricted' && member.is_member === true);
export const PERMISSION_KEYS = [
  'can_send_messages', 'can_send_audios', 'can_send_documents', 'can_send_photos',
  'can_send_videos', 'can_send_video_notes', 'can_send_voice_notes', 'can_send_polls',
  'can_send_other_messages', 'can_add_web_page_previews', 'can_change_info',
  'can_invite_users', 'can_pin_messages', 'can_manage_topics', 'can_react_to_messages', 'can_edit_tag',
];
export const permissions = (source = {}) => Object.fromEntries(PERMISSION_KEYS.map(k => [k, source[k] === true]));
export const mutedPermissions = () => permissions();
export function restoredPermissions(challenge, defaults, timestamp = now()) {
  if (!challenge.was_restricted || (challenge.original_until && challenge.original_until <= timestamp)) {
    // Lifting individual restrictions still respects the chat's default rights.
    return Object.fromEntries(PERMISSION_KEYS.map(k => [k, true]));
  }
  const original = JSON.parse(challenge.original_permissions);
  return Object.fromEntries(PERMISSION_KEYS.map(k => [k, original[k] === true && defaults[k] === true]));
}
export function canManage(member, kind) {
  return member?.status === 'creator' || (member?.status === 'administrator'
    && member.can_invite_users === true && (kind === 'channel' || member.can_restrict_members === true));
}
export function missingRights(member, mode) {
  if (!isAdmin(member)) return 'нужны права администратора';
  if (!member.can_invite_users && member.status !== 'creator') return 'нужно право приглашать участников';
  if (mode === 'captcha' && !member.can_restrict_members && member.status !== 'creator') return 'нужно право ограничивать участников';
  return null;
}
export function adminRights(channel) {
  return {
    is_anonymous: false, can_manage_chat: true, can_delete_messages: false,
    can_manage_video_chats: false, can_restrict_members: !channel,
    can_promote_members: false, can_change_info: false, can_invite_users: true,
    can_post_stories: false, can_edit_stories: false, can_delete_stories: false,
    ...(channel ? { can_post_messages: false, can_edit_messages: false } : { can_pin_messages: false }),
  };
}
function shuffled(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function makePuzzle(type, random = Math.random) {
  if (type === 'math') {
    const a = 2 + Math.floor(random() * 8), b = 2 + Math.floor(random() * 8), correct = a + b;
    const options = shuffled([correct, correct + 1, correct - 1, correct + 2, correct - 2, correct + 3], random);
    return { question: `${a} + ${b} = ?`, options: options.map(String), answer: options.indexOf(correct) };
  }
  const pool = [['🍎','яблоко'], ['🍋','лимон'], ['🍇','виноград'], ['🍓','клубнику'],
    ['🥕','морковь'], ['🍉','арбуз'], ['🍌','банан'], ['🍒','вишню'], ['🥝','киви'], ['🍍','ананас']];
  const choices = shuffled(pool, random).slice(0, 6), answer = Math.floor(random() * choices.length);
  return { question: `нажми на ${choices[answer][1]}`, options: choices.map(x => x[0]), answer };
}
export function parseCaptcha(data) {
  const match = /^v:(\d+):(\d+):([0-5])$/.exec(data || '');
  if (!match) return null;
  const [id, version, answer] = match.slice(1).map(Number);
  return [id, version, answer].every(Number.isSafeInteger) ? { id, version, answer } : null;
}
