/**
 * Service worker: settings defaults, keyboard command routing and on-demand injection of
 * the vision runtime into the Meet tab's MAIN world. It never sees video frames.
 */
import { SETTINGS_STORAGE_KEY, migrateSettings } from '../shared/settings';

const MEET_ORIGIN = 'https://meet.google.com';
const VISION_FILES = ['wasm/vision_wasm_internal.js', 'vision.js'];

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: migrateSettings(current[SETTINGS_STORAGE_KEY]) });
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith(`${MEET_ORIGIN}/`)) return;
  chrome.tabs.sendMessage(tab.id, { type: 'command', command }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg: { type?: string }, sender, reply) => {
  if (msg?.type !== 'inject-vision') return false;
  const tabId = sender.tab?.id;
  const fromMeet = sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(`${MEET_ORIGIN}/`);
  if (!tabId || !fromMeet) {
    reply({ ok: false, error: 'rejected sender' });
    return false;
  }
  chrome.scripting
    .executeScript({
      target: { tabId, frameIds: [sender.frameId ?? 0] },
      files: VISION_FILES,
      world: 'MAIN',
      injectImmediately: true,
    })
    .then(
      () => reply({ ok: true }),
      (e: unknown) => reply({ ok: false, error: String((e as Error)?.message ?? e) }),
    );
  return true;
});
