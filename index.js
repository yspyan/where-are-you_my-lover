(async () => {
    const { getContext, saveSettingsDebounced, renderExtensionTemplateAsync, eventSource, event_types } = SillyTavern.getContext();
    const { extensionSettings } = SillyTavern.getContext();

    const EXT_NAME = 'timeline-rift';
    const STORAGE_KEY = 'rift_pool';

    const DEFAULT_SETTINGS = {
        enabled: true,
        probability: 15,
        min_interval: 8,
        enabled_chars: {},
    };

    function getSettings() {
        if (!extensionSettings[EXT_NAME]) {
            extensionSettings[EXT_NAME] = Object.assign({}, DEFAULT_SETTINGS);
        }
        return extensionSettings[EXT_NAME];
    }

    function getPool() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
        catch { return {}; }
    }

    function setPool(pool) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(pool));
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function syncCurrentChat() {
        const ctx = SillyTavern.getContext();
        if (!ctx || !ctx.name2 || !ctx.chatId) return;
        const charName = ctx.name2;
        const chatId = ctx.chatId;
        const settings = getSettings();
        const charCfg = settings.enabled_chars[charName];
        if (!charCfg || !charCfg.enabled) return;
        if (charCfg.chats && charCfg.chats[chatId] === false) return;
        const msgs = (ctx.chat || []).filter(m => !m.is_system).slice(-30).map(m => ({
            role: m.is_user ? 'user' : 'char', content: m.mes, name: m.name
        }));
        if (!msgs.length) return;
        const pool = getPool();
        if (!pool[charName]) pool[charName] = {};
        pool[charName][chatId] = msgs;
        setPool(pool);
    }

    function pickIntrusionMessage(currentCharName, currentChatId) {
        const pool = getPool();
        const charPool = pool[currentCharName];
        if (!charPool) return null;
        const otherIds = Object.keys(charPool).filter(id => id !== currentChatId);
        if (!otherIds.length) return null;
        const sourceChatId = otherIds[Math.floor(Math.random() * otherIds.length)];
        const msgs = charPool[sourceChatId];
        if (!msgs || !msgs.length) return null;
        const charMsgs = msgs.filter(m => m.role === 'char' && m.content && m.content.trim().length > 10);
        if (!charMsgs.length) return null;
        const msg = charMsgs[Math.floor(Math.random() * charMsgs.length)];
        return { content: msg.content, sourceChatId };
    }

    let messagesSinceLastRift = 0;
    const RIFT_STYLES = ['glitch', 'note', 'terminal'];

    function tryTriggerRift() {
        const settings = getSettings();
        if (!settings.enabled) return;
        const ctx = SillyTavern.getContext();
        if (!ctx || !ctx.name2 || !ctx.chatId) return;
        messagesSinceLastRift++;
        if (messagesSinceLastRift < settings.min_interval) return;
        if (Math.random() * 100 > settings.probability) return;
        messagesSinceLastRift = 0;
        const intrusion = pickIntrusionMessage(ctx.name2, ctx.chatId);
        if (!intrusion) return;
        const shortId = intrusion.sourceChatId.slice(-6);
        const style = RIFT_STYLES[Math.floor(Math.random() * RIFT_STYLES.length)];
        const content = escapeHtml(intrusion.content);
        const mes = `<rift style="${style}" from="${shortId}" char="${escapeHtml(ctx.name2)}">${content}</rift>`;
        const { addOneMessage } = SillyTavern.getContext();
        addOneMessage({ name: `异线·${ctx.name2}`, is_user: false, is_system: true, mes, extra: { rift: true } });
    }

    async function renderCharList() {
        const settings = getSettings();
        const $list = $('#rift-char-list');
        $list.html('<div class="rift-empty">加载中…</div>');
        const ctx = SillyTavern.getContext();
        const allChars = ctx.characters || [];
        if (!allChars.length) { $list.html('<div class="rift-empty">没有找到角色卡</div>'); return; }
        $list.empty();
        for (const char of allChars) {
            const charName = char.name;
            if (!settings.enabled_chars[charName]) settings.enabled_chars[charName] = { enabled: false, chats: {} };
            const cfg = settings.enabled_chars[charName];
            let chatFiles = [];
            try {
                const resp = await fetch(`/api/characters/chats?avatar=${encodeURIComponent(char.avatar)}`);
                if (resp.ok) chatFiles = await resp.json() || [];
            } catch {}
            const $item = $(`<div class="rift-char-item"><div class="rift-char-header"><input type="checkbox" class="rift-char-enable" ${cfg.enabled?'checked':''}/><span class="rift-char-name">${escapeHtml(charName)}</span><span class="rift-char-toggle">${chatFiles.length?'▾ '+chatFiles.length+'条记录':'无记录'}</span></div><div class="rift-chat-list ${cfg.enabled?'open':''}"></div></div>`);
            const $chatList = $item.find('.rift-chat-list');
            for (const cf of chatFiles) {
                const chatId = cf.file_name || cf.id || String(cf);
                const chatEnabled = cfg.chats[chatId] !== false;
                $chatList.append(`<div class="rift-chat-item"><input type="checkbox" class="rift-chat-enable" data-chatid="${escapeHtml(chatId)}" ${chatEnabled?'checked':''}/><span>${escapeHtml(chatId)}</span></div>`);
            }
            if (!chatFiles.length) $chatList.append('<div style="opacity:0.4;font-size:0.82em;">暂无聊天记录</div>');
            $item.find('.rift-char-enable').on('change', function() { cfg.enabled=this.checked; $chatList.toggleClass('open',this.checked); saveSettingsDebounced(); });
            $item.find('.rift-char-header').on('click', function(e) { if($(e.target).is('input'))return; $chatList.toggleClass('open'); });
            $item.find('.rift-chat-enable').on('change', function() { cfg.chats[$(this).data('chatid')]=this.checked; saveSettingsDebounced(); });
            $list.append($item);
        }
        saveSettingsDebounced();
    }

    async function loadSettingsPanel() {
        const settings = getSettings();
        const html = `<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>Timeline Rift · 异线闯入</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><div class="rift-section"><label><input type="checkbox" id="rift-enabled" ${settings.enabled?'checked':''}/>&nbsp;启用异线闯入</label></div><div class="rift-section"><label>触发概率</label><div class="rift-row"><input type="range" id="rift-probability" min="1" max="50" value="${settings.probability}"/><span class="rift-val" id="rift-probability-val">${settings.probability}%</span></div></div><div class="rift-section"><label>最少间隔消息数</label><div class="rift-row"><input type="range" id="rift-interval" min="1" max="30" value="${settings.min_interval}"/><span class="rift-val" id="rift-interval-val">${settings.min_interval}条</span></div></div><div class="rift-section"><label>参与串线的角色卡</label><button id="rift-refresh-btn" class="menu_button">🔄 刷新</button><div id="rift-char-list"><div class="rift-empty">加载中…</div></div></div></div></div>`;
        $('#extensions_settings2').append(html);
        $('#rift-enabled').on('change', function() { getSettings().enabled=this.checked; saveSettingsDebounced(); });
        $('#rift-probability').on('input', function() { const v=parseInt(this.value); getSettings().probability=v; $('#rift-probability-val').text(v+'%'); saveSettingsDebounced(); });
        $('#rift-interval').on('input', function() { const v=parseInt(this.value); getSettings().min_interval=v; $('#rift-interval-val').text(v+'条'); saveSettingsDebounced(); });
        $('#rift-refresh-btn').on('click', renderCharList);
        await renderCharList();
    }

    eventSource.on(event_types.APP_READY, async () => {
        await loadSettingsPanel();
    });

    eventSource.on(event_types.MESSAGE_RECEIVED, () => { syncCurrentChat(); tryTriggerRift(); });
    eventSource.on(event_types.CHAT_CHANGED, () => { messagesSinceLastRift=0; syncCurrentChat(); });

    console.log('[Timeline Rift] 已加载');
})();
