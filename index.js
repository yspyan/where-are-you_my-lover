async function renderCharList() {
    const settings = getSettings();
    const $list = $('#rift-char-list');
    $list.html('<div class="rift-empty">加载中…</div>');

    let allChars = [];
    const ctx = SillyTavern.getContext();

    // 1. 获取所有角色：优先用酒馆内存里的，没有则从本地存储兜底
    try {
        if (ctx.characters && ctx.characters.length) {
            allChars = ctx.characters;
        } else {
            const raw = localStorage.getItem('characters');
            if (raw) allChars = Object.values(JSON.parse(raw));
        }
    } catch (e) {
        allChars = [];
    }

    if (!allChars.length) {
        $list.html('<div class="rift-empty">没有找到角色卡，请先创建或导入角色</div>');
        return;
    }

    // 2. 获取所有聊天记录索引（酒馆本地就存着）
    let allChats = [];
    try {
        // 这个 API 在新版中通常返回 { chats: [...] }
        const resp = await fetch('/api/chats');
        if (resp.ok) {
            const data = await resp.json();
            allChats = Array.isArray(data) ? data : (data.chats || []);
        }
    } catch (e) {
        // 如果 /api/chats 不存在，尝试从 indexedDB 或 localStorage 兜底（可忽略，一般都有）
        allChats = [];
    }

    $list.empty();

    for (const char of allChars) {
        const charName = char.name;
        if (!settings.enabled_chars[charName]) {
            settings.enabled_chars[charName] = { enabled: false, chats: {} };
        }
        const cfg = settings.enabled_chars[charName];

        // 筛选出属于该角色的聊天记录
        const chatFiles = allChats.filter(c => {
            const chatChar = c.character_name || c.name2 || c.character || '';
            return chatChar === charName;
        });

        const $item = $(`
            <div class="rift-char-item">
                <div class="rift-char-header">
                    <input type="checkbox" class="rift-char-enable" ${cfg.enabled ? 'checked' : ''}/>
                    <span class="rift-char-name">${escapeHtml(charName)}</span>
                    <span class="rift-char-toggle">${chatFiles.length ? '▾ ' + chatFiles.length + '条记录' : '无记录'}</span>
                </div>
                <div class="rift-chat-list ${cfg.enabled ? 'open' : ''}"></div>
            </div>
        `);

        const $chatList = $item.find('.rift-chat-list');
        for (const chat of chatFiles) {
            const chatId = chat.file_name || chat.id || chat.chat_id || String(chat);
            const chatEnabled = cfg.chats[chatId] !== false;
            $chatList.append(`
                <div class="rift-chat-item">
                    <input type="checkbox" class="rift-chat-enable" data-chatid="${escapeHtml(chatId)}" ${chatEnabled ? 'checked' : ''}/>
                    <span>${escapeHtml(chatId)}</span>
                </div>
            `);
        }

        if (!chatFiles.length) {
            $chatList.append('<div style="opacity:0.4;font-size:0.82em;">暂无聊天记录</div>');
        }

        // 绑定事件
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
