// 安全启动：等酒馆核心加载完再运行，手机电脑都兼容
const initTimelineRift = () => {
    const { getContext, saveSettingsDebounced, eventSource, event_types } = SillyTavern.getContext();
    const { extensionSettings } = SillyTavern.getContext();

    const EXT_NAME = 'timeline-rift';
    const STORAGE_KEY = 'rift_pool';

    const DEFAULT_SETTINGS = {
        enabled: true,
        probability: 15,
        min_interval: 8,
        enabled_chars: {},
    };

    // 状态锁：防止异线生成陷入死循环
    let isGeneratingRift = false;
    let currentRiftSourceId = '';
    let messagesSinceLastRift = 0;
    const RIFT_STYLES = ['glitch', 'note', 'terminal'];

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

    // ===== 核心功能重写：不再抽取单句死台词，而是实时读取另一条线的上下文并命令LLM生成 =====
    async function tryTriggerRift() {
        if (isGeneratingRift) return; // 正在生成异线时不再触发

        const settings = getSettings();
        if (!settings.enabled) return;
        
        const ctx = SillyTavern.getContext();
        if (!ctx || !ctx.name2 || !ctx.chatId || !ctx.character_id) return;
        
        messagesSinceLastRift++;
        if (messagesSinceLastRift < settings.min_interval) return;
        if (Math.random() * 100 > settings.probability) return;
        
        // 寻找符合条件的其他时间线
        const charName = ctx.name2;
        const currentChatId = ctx.chatId;
        const charCfg = settings.enabled_chars[charName];
        if (!charCfg || !charCfg.enabled) return;

        // 获取酒馆里该角色的所有活跃档案
        let chatFiles = [];
        try {
            const headers = typeof getRequestHeaders === 'function' ? getRequestHeaders() : { 'Content-Type': 'application/json' };
            const response = await fetch('/api/characters/chats', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ avatar_url: ctx.characters[ctx.character_id].avatar })
            });
            if (response.ok) {
                const data = await response.json();
                const rawChats = Array.isArray(data) ? data : Object.values(data || {});
                chatFiles = rawChats.map(c => typeof c === 'string' ? chatId : (c.file_name || c.id)).filter(id => id && id !== currentChatId);
            }
        } catch (e) { console.error('[Rift] 获取在线列表失败', e); }

        // 如果云端没查到，降级使用本地池
        if (!chatFiles.length) {
            const pool = getPool();
            if (pool[charName]) {
                chatFiles = Object.keys(pool[charName]).filter(id => id !== currentChatId);
            }
        }

        // 过滤掉被玩家在面板上关闭了的时间线
        const activeOtherChats = chatFiles.filter(id => charCfg.chats[id] !== false);
        if (!activeOtherChats.length) return;

        // 随机抽选一条“异时间线”
        const sourceChatId = activeOtherChats[Math.floor(Math.random() * activeOtherChats.length)];
        messagesSinceLastRift = 0;
        isGeneratingRift = true;
        currentRiftSourceId = sourceChatId;

        // 读取那条时间线的最后几句话，作为记忆碎片
        let otherContextText = "未知时空混乱，记忆模糊...";
        try {
            const headers = typeof getRequestHeaders === 'function' ? getRequestHeaders() : { 'Content-Type': 'application/json' };
            const res = await fetch('/api/chats/get', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ avatar_url: ctx.characters[ctx.character_id].avatar, file_name: sourceChatId })
            });
            if (res.ok) {
                const chatData = await res.json();
                if (Array.isArray(chatData) && chatData.length) {
                    otherContextText = chatData.filter(m => !m.is_system).slice(-5).map(m => `${m.is_user ? '玩家' : charName}: ${m.mes}`).join('\n');
                }
            }
        } catch (e) {
            // 降级使用本地池记忆
            const pool = getPool();
            if (pool[charName] && pool[charName][sourceChatId]) {
                otherContextText = pool[charName][sourceChatId].slice(-5).map(m => `${m.role === 'user' ? '玩家' : charName}: ${m.content}`).join('\n');
            }
        }

        // 构造高能记忆入侵的【系统隐蔽提示】，强迫LLM实时扮演闯入者
        const { addOneMessage } = SillyTavern.getContext();
        const shortId = sourceChatId.slice(-6);
        
        const systemPrompt = `【时空裂缝爆发：平行現実世界入侵】
警告：当前时间线遭遇高能穿透！另一个平行宇宙的你（${charName}）由于强烈情感或因果共振，声音瞬间在当前时空炸裂。
你在那个宇宙（时间线ID: ${shortId}）里，刚刚经历的最新记忆画面如下：
=========================
${otherContextText}
=========================
现在，请你彻底切入那个平行宇宙的记忆、立场、重创或执念，打破当前的日常对白，以一个【跨境闯入者】的身份，对当前宇宙的局面、玩家或当下的自己，进行一次【实时高能的跨界发言】！你的话语中必须暴露出你带过来的那个世界的记忆、秘密或极端情绪！`;

        // 塞入系统指示，并立刻驱动酒馆生成新消息
        addOneMessage({
            name: "SYSTEM",
            is_user: false,
            is_system: true,
            mes: `🌀 [时空不稳定：检测到来自平行线档案 [${shortId}] 的意识正在强行闯入...]`,
            extra: { rift_announcement: true }
        });

        setTimeout(() => {
            // 偷偷把系统注入写入当前生成的隐式前缀里
            const currentChat = SillyTavern.getContext().chat;
            if (currentChat && currentChat.length) {
                currentChat[currentChat.length - 1].mes += `\n\n[MANDATORY SYSTEM DIRECTIVE FOR NEXT RESPONSE: ${systemPrompt}]`;
            }
            // 模拟触发酒馆生成按钮，让LLM现场写词
            $('#send_button').click();
        }, 300);
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
                const headers = typeof getRequestHeaders === 'function' ? getRequestHeaders() : { 'Content-Type': 'application/json' };
                const response = await fetch('/api/characters/chats', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ avatar_url: char.avatar })
                });
                if (response.ok) {
                    const data = await response.json();
                    const rawChats = Array.isArray(data) ? data : Object.values(data || {});
                    chatFiles = rawChats.map(c => typeof c === 'string' ? { file_name: c } : c);
                }
            } catch (err) {
                console.error('[Rift] 获取聊天记录失败:', err);
            }

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

    // 拦截AI生成完的信息，打上异线标志和特效标签
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        const ctx = SillyTavern.getContext();
        if (!ctx || !ctx.chat || !ctx.chat.length) return;
        
        const lastMsg = ctx.chat[ctx.chat.length - 1];
        
        // 如果是刚刚被我们催生出来的异线消息
        if (isGeneratingRift && lastMsg && !lastMsg.is_user && !lastMsg.is_system && !lastMsg.extra?.rift) {
            const shortId = currentRiftSourceId.slice(-6);
            const style = RIFT_STYLES[Math.floor(Math.random() * RIFT_STYLES.length)];
            
            // 冠以异线假名，并包裹特效UI标签
            lastMsg.name = `异线·${ctx.name2}`;
            lastMsg.mes = `<rift style="${style}" from="${shortId}" char="${ctx.name2}">${lastMsg.mes}</rift>`;
            lastMsg.extra = lastMsg.extra || {};
            lastMsg.extra.rift = true;
            
            isGeneratingRift = false; // 解锁
            
            // 刷新当前聊天UI，让假名和特效当场渲染生效
            if (typeof renderChat === 'function') renderChat();
            else if (ctx.renderChat) ctx.renderChat();
        } else if (!isGeneratingRift && lastMsg && !lastMsg.is_user && !lastMsg.is_system) {
            // 如果是普通的AI正常回话结束，则记录历史并进行概率判定，看是否触发闯入
            syncCurrentChat();
            tryTriggerRift();
        }
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        messagesSinceLastRift = 0;
        isGeneratingRift = false;
        syncCurrentChat();
    });

    console.log('[Timeline Rift] 实时高能代入版已加载');
};

const riftInterval = setInterval(() => {
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        clearInterval(riftInterval);
        initTimelineRift();
    }
}, 100);
