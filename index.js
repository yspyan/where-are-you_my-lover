import {
    getContext,
    saveSettingsDebounced,
    extension_settings,
} from '../../../extensions.js';

import {
    eventSource,
    event_types,
    addOneMessage,
    characters,
} from '../../../../script.js';

const EXT_NAME = 'timeline-rift';
const STORAGE_KEY = 'rift_pool';

const DEFAULT_SETTINGS = {
    enabled: true,
    probability: 15,
    min_interval: 8,
    enabled_chars: {},
};

function getSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = Object.assign({}, DEFAULT_SETTINGS);
    }
    return extension_settings[EXT_NAME];
}

function getPool() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch { return {}; }
}

function setPool(pool) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pool));
}

function syncCurrentChat() {
    const ctx = getContext();
    if (!ctx || !ctx.name2 || !ctx.chatId) return;
    const charName = ctx.name2;
    const chatId = ctx.chatId;
    const settings = getSettings();
    const charCfg = settings.enabled_chars[charName];
    if (!charCfg || !charCfg.enabled) return;
    if (charCfg.chats && charCfg.chats[chatId] === false) return;
    const msgs = (ctx.chat || [])
        .filter(m => !m.is_system)
        .slice(-30)
        .map(m => ({ role: m.is_user ? 'user' : 'char', content: m.mes, name: m.name }));
    if (msgs.length === 0) return;
    const pool = getPool();
    if (!pool[charName]) pool[charName] = {};
    pool[charName][chatId] = msgs;
    setPool(pool);
}

function pickIntrusionMessage(currentCharName, currentChatId) {
    const pool = getPool();
    const charPool = pool[currentCharName];
    if (!charPool) return null;
    const otherChatIds = Object.keys(charPool).filter(id => id !== currentChatId);
    if (otherChatIds.length === 0) return null;
    const sourceChatId = otherChatIds[Math.floor(Math.random() * otherChatIds.length)];
    const msgs = charPool[sourceChatId];
    if (!msgs || msgs.length === 0) return null;
    const charMsgs = msgs.filter(m => m.role === 'char' && m.content && m.content.trim().length > 10);
    if (charMsgs.length === 0) return null;
    const msg = charMsgs[Math.floor(Math.random() * charMsgs.length)];
    return { content: msg.content, sourceChatId };
}

let messagesSinceLastRift = 0;

function tryTriggerRift() {
    const settings = getSettings();
    if (!settings.enabled) return;
    const ctx = getContext();
    if (!ctx || !ctx.name2 || !ctx.chatId) return;
    messagesSinceLastRift++;
    if (messagesSinceLastRift < settings.min_interval) return;
    const roll = Math.random() * 100;
    if (roll > settings.probability) return;
    messagesSinceLastRift = 0;
    const intrusion = pickIntrusionMessage(ctx.name2, ctx.chatId);
    if (!intrusion) return;
    injectIntrusionMessage(ctx.name2, intrusion);
}

const RIFT_STYLES = ['glitch', 'note', 'terminal'];

function injectIntrusionMessage(charName, intrusion) {
    const shortId = intrusion.sourceChatId.slice(-6);
    const style = RIFT_STYLES[Math.floor(Math.random() * RIFT_STYLES.length)];
    const content = escapeHtml(intrusion.content);
    const mes = `<rift style="${style}" from="${shortId}" char="${escapeHtml(charName)}">${content}</rift>`;
    addOneMessage({
        name: `异线·${charName}`,
        is_user: false,
        is_system: true,
        mes,
        extra: { rift: true },
    });
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function loadSettingsPanel() {
    const settings = getSettings();
    const html = `
<div id="timeline-rift-settings">
    <div class="rift-section">
        <label><input type="checkbox" id="rift-enabled" ${settings.enabled ? 'checked' : ''}/>&nbsp;启用异线闯入</label>
    </div>
    <div class="rift-section">
        <label>触发概率（每条消息）</label>
        <div class="rift-row">
            <input type="range" id="rift-probability" min="1" max="50" value="${settings.probability}" />
            <span class="rift-val" id="rift-probability-val">${settings.probability}%</span>
        </div>
    </div>
    <div class="rift-section">
        <label>最少间隔消息数</label>
        <div class="rift-row">
            <input type="range" id="rift-interval" min="1" max="30" value="${settings.min_interval}" />
            <span class="rift-val" id="rift-interval-val">${settings.min_interval}条</span>
        </div>
    </div>
    <div class="rift-section">
        <label>参与串线的角色卡与聊天记录</label>
        <button id="rift-refresh-btn" class="menu_button">🔄 刷新列表</button>
        <div id="rift-char-list"><div class="rift-empty">加载中…</div></div>
    </div>
</div>`;

    $('#extensions_settings2').append(`
<div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
        <b>Timeline Rift · 异线闯入</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">${html}</div>
</div>`);

    bindSettingsEvents();
    await renderCharList();
}

function bindSettingsEvents() {
    $('#rift-enabled').on('change', function () {
        getSettings().enabled = this.checked;
        saveSettingsDebounced();
    });
    $('#rift-probability').on('input', function () {
        const v = parseInt(this.value);
        getSettings().probability = v;
        $('#rift-probability-val').text(v + '%');
        saveSettingsDebounced();
    });
    $('#rift-interval').on('input', function () {
        const v = parseInt(this.value);
        getSettings().min_interval = v;
        $('#rift-interval-val').text(v + '条');
        saveSettingsDebounced();
    });
    $('#rift-refresh-btn').on('click', renderCharList);
}

async function renderCharList() {
    const settings = getSettings();
    const $list = $('#rift-char-list');
    $list.html('<div class="rift-empty">加载中…</div>');
    const allChars = characters || [];
    if (allChars.length === 0) {
        $list.html('<div class="rift-empty">没有找到角色卡</div>');
        return;
    }
    $list.empty();
    for (const char of allChars) {
        const charName = char.name;
        if (!settings.enabled_chars[charName]) {
            settings.enabled_chars[charName] = { enabled: false, chats: {} };
        }
        const cfg = settings.enabled_chars[charName];
        let chatFiles = [];
        try {
            const resp = await fetch(`/api/characters/chats?avatar=${encodeURIComponent(char.avatar)}`);
            if (resp.ok) chatFiles = await resp.json() || [];
        } catch {}

        const $item = $(`
<div class="rift-char-item" data-char="${escapeHtml(charName)}">
    <div class="rift-char-header">
        <input type="checkbox" class="rift-char-enable" ${cfg.enabled ? 'checked' : ''} />
        <span class="rift-char-name">${escapeHtml(charName)}</span>
        <span class="rift-char-toggle">${chatFiles.length > 0 ? '▾ ' + chatFiles.length + '条记录' : '无记录'}</span>
    </div>
    <div class="rift-chat-list ${cfg.enabled ? 'open' : ''}"></div>
</div>`);

        const $chatList = $item.find('.rift-chat-list');
        for (const cf of chatFiles) {
            const chatId = cf.file_name || cf.id || String(cf);
            const chatLabel = cf.file_name || chatId;
            const chatEnabled = cfg.chats[chatId] !== false;
            $chatList.append(`
<div class="rift-chat-item">
    <input type="checkbox" class="rift-chat-enable" data-chatid="${escapeHtml(chatId)}" ${chatEnabled ? 'checked' : ''} />
    <span>${escapeHtml(chatLabel)}</span>
</div>`);
        }
        if (chatFiles.length === 0) {
            $chatList.append('<div style="opacity:0.4;font-size:0.82em;">暂无聊天记录</div>');
        }

        $item.find('.rift-char-enable').on('change', function () {
            cfg.enabled = this.checked;
            $chatList.toggleClass('open', this.checked);
            saveSettingsDebounced();
        });
        $item.find('.rift-char-header').on('click', function (e) {
            if ($(e.target).is('input')) return;
            $chatList.toggleClass('open');
        });
        $item.find('.rift-chat-enable').on('change', function () {
            cfg.chats[$(this).data('chatid')] = this.checked;
            saveSettingsDebounced();
        });
        $list.append($item);
    }
    saveSettingsDebounced();
}

jQuery(async () => {
    await loadSettingsPanel();
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        syncCurrentChat();
        tryTriggerRift();
    });
    eventSource.on(event_types.CHAT_CHANGED, () => {
        messagesSinceLastRift = 0;
        syncCurrentChat();
    });
    console.log('[Timeline Rift] 已加载');
});
