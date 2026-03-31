require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

if (!process.env.BOT_TOKEN) { process.exit(1); }
if (!process.env.OPENAI_API_KEY) { process.exit(1); }

const ADMIN_IDS = '8562012978, 6726680644, 489276394, 7425797743';

const SSS_GROUP_ID = -1003747509040;
const SSS_TOPIC_ID = 3;
const SSS_SITE = 'https://devbydnk.com';
const SSS_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function isAdmin(ctx) {
    if (ADMIN_IDS.length === 0) return false;
    const userId = String(ctx.from?.id ?? '');
    return ADMIN_IDS.includes(userId);
}

function adminOnly(ctx, next) {
    if (!isAdmin(ctx)) return;
    return next();
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CHANNEL_IDS = {
    en: process.env.CHANNEL_EN,
    ua: process.env.CHANNEL_UA,
    ru: process.env.CHANNEL_RU,
    pl: process.env.CHANNEL_PL,
    de: process.env.CHANNEL_DE,
    main: process.env.CHANNEL_MAIN,
};

const localSession = new LocalSession({ database: 'sessions.json' });
bot.use(localSession.middleware());

const bKb = Markup.inlineKeyboard([[Markup.button.callback('Назад', 'cmd_back')]]);

async function ui(ctx, txt, ext = {}) {
    if (ctx.callbackQuery) { try { await ctx.editMessageText(txt, ext); return; } catch(e) { if(e.message.includes('not modified')) return; } }
    if (ctx.session?.mid) { try { await ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.mid); } catch(e) {} }
    const m = await ctx.reply(txt, ext);
    if (ctx.session) ctx.session.mid = m.message_id;
}

bot.action('cmd_back', async ctx => {
    await ctx.answerCbQuery().catch(()=>{});
    if (ctx.session) ctx.session.awaiting_post_text = false;
    await ui(ctx, 'Выбери действие:', buildStartKeyboard());
});

bot.on('text', async (ctx, next) => {
    const msg = ctx.message;
    if (!msg) return next();
    const chatId = msg.chat?.id;
    const threadId = msg.message_thread_id;
    const text = msg.text || '';
    if (chatId === SSS_GROUP_ID && threadId === SSS_TOPIC_ID) {
        const fromId = String(msg.from?.id || '');
        const senderChatId = String(msg.sender_chat?.id || '');
        const TARGET_ID = '8562012978';
        if ((fromId === TARGET_ID || senderChatId === TARGET_ID) && /update/i.test(text)) {
            incrementLiveUpdateCount();
            console.log(`[SSS] UPDATE: ${getLiveUpdateCount()}`);
        }
    }
    return next(); 
});

const STATS_FILE = path.join(__dirname, 'stats.json');

function loadStats() {
    if (!fs.existsSync(STATS_FILE)) return { posts: [], subscriberSnapshots: [] };
    try { return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); }
    catch { return { posts: [], subscriberSnapshots: [] }; }
}

function saveStats(data) {
    fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2));
}

function saveSubscriberSnapshot(counts) {
    const data = loadStats();
    const today = new Date().toISOString().slice(0, 10);
    data.subscriberSnapshots = (data.subscriberSnapshots || []).filter(s => s.date !== today).slice(-59);
    data.subscriberSnapshots.push({ date: today, counts });
    saveStats(data);
}

const SSS_FILE = path.join(__dirname, 'sss.json');

function loadSss() {
    if (!fs.existsSync(SSS_FILE)) return { enabled: false };
    try { return JSON.parse(fs.readFileSync(SSS_FILE, 'utf8')); }
    catch { return { enabled: false }; }
}

function saveSss(data) {
    fs.writeFileSync(SSS_FILE, JSON.stringify(data, null, 2));
}

function isSssEnabled() { return loadSss().enabled === true; }

function setSssEnabled(val) {
    const data = loadSss();
    data.enabled = val;
    saveSss(data);
}

function checkSite(url) {
    return new Promise(resolve => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, { timeout: 10000 }, res => {
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode });
            res.resume();
        });
        req.on('error', () => resolve({ ok: false, status: null }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: null }); });
    });
}

function getLiveUpdateCount() {
    return loadSss().liveUpdateCount || 0;
}

function incrementLiveUpdateCount() {
    const data = loadSss();
    data.liveUpdateCount = (data.liveUpdateCount || 0) + 1;
    saveSss(data);
}

async function buildSssReport() {
    const { ok, status } = await checkSite(SSS_SITE);
    const liveCount = getLiveUpdateCount();
    const statusLine = ok ? '🟢 Status — Live' : `🔴 Status — Down (HTTP ${status ?? 'no response'})`;
    return `🖥 Server Status Scanner\n${statusLine}\n📨 View count: ${liveCount}`;
}

const CHANNEL_LABELS = { en: 'EN', ua: 'UA', ru: 'RU', pl: 'PL', de: 'DE', main: 'Main' };
const CHANNEL_KEYS = Object.keys(CHANNEL_LABELS);

function defaultPostState() {
    return {
        channels: { en: false, ua: false, ru: false, pl: false, de: false, main: false },
        photos: { en: null, ua: null, ru: null, pl: null, de: null, main: null },
        translations: {},
        awaiting_post_text: false,
        awaiting_photo_for: null,
    };
}

async function showPhotoMenu(ctx) {
    const activeKeys = CHANNEL_KEYS.filter(k => ctx.session.channels[k]);
    let text = 'Текст переведен. Можешь добавить фото для каждого канала по отдельности (нажми на кнопку и отправь фото):\n\n';
    const rows = [];
    for (const key of activeKeys) {
        const hasPhoto = ctx.session.photos[key] ? '🖼 ✅' : '❌ Нет фото';
        text += `${CHANNEL_LABELS[key]}: ${hasPhoto}\n`;
        rows.push([Markup.button.callback(`${CHANNEL_LABELS[key]}: ${ctx.session.photos[key] ? 'Изменить фото' : 'Добавить фото'}`, `add_photo_${key}`)]);
    }
    rows.push([Markup.button.callback('🚀 Отправить всё', 'final_send')]);
    rows.push([Markup.button.callback('Отмена', 'cmd_back')]);
    await ui(ctx, text, Markup.inlineKeyboard(rows));
}

async function sendFinalPosts(ctx) {
    const activeKeys = CHANNEL_KEYS.filter(k => ctx.session.channels[k]);
    const translations = ctx.session.translations || {};
    const photos = ctx.session.photos || {};
    const sourceText = ctx.session.sourceText || '';
    
    const postId = Date.now();
    const data = loadStats();
    data.posts.push({ id: postId, date: new Date().toISOString(), channels: activeKeys, text: sourceText.slice(0, 80), views: {}, messageIds: {} });
    saveStats(data);

    let successCount = 0;
    for (const key of activeKeys) {
        const text = translations[key];
        if (!text) continue;
        const channelId = CHANNEL_IDS[key];
        if (!channelId) continue;
        
        try {
            let sent;
            if (photos[key]) {
                sent = await bot.telegram.sendPhoto(channelId, photos[key], { caption: text });
            } else {
                sent = await bot.telegram.sendMessage(channelId, text);
            }
            
            const fresh = loadStats();
            const post = fresh.posts.find(p => p.id === postId);
            if (post) { 
                post.messageIds[key] = sent.message_id; 
                saveStats(fresh); 
            }
            successCount++;
        } catch (sendErr) {
            console.error(`Error sending to ${key}:`, sendErr);
        }
    }
    
    await ui(ctx, `Успешно отправлено в ${successCount} каналов. Через 1 час запусти /updateviews для статистики.`, bKb);
    Object.assign(ctx.session, defaultPostState());
}

function buildChannelKeyboard(channels) {
    const rows = CHANNEL_KEYS.map(key => {
        const label = `${channels[key] ? '➕ ' : ''}${CHANNEL_LABELS[key]}`;
        return [Markup.button.callback(label, `toggle_${key}`)];
    });
    rows.push([Markup.button.callback('Запостить', 'make_post')]);
    rows.push([Markup.button.callback('Назад', 'cmd_back')]);
    return Markup.inlineKeyboard(rows);
}

function buildStartKeyboard() {
    const sssOn = isSssEnabled();
    return Markup.inlineKeyboard([
        [Markup.button.callback('Пост в ТГК', 'cmd_post')],
        [Markup.button.callback('Статистика', 'cmd_stat')],
        [Markup.button.callback(`Server Status Scanner (SSS) is ${sssOn ? 'on ➕' : 'off ✖️'}`, 'toggle_sss')],
    ]);
}

async function buildStatText() {
    const activeChannels = CHANNEL_KEYS.filter(k => CHANNEL_IDS[k]);
    const memberResults = await Promise.allSettled(activeChannels.map(key => bot.telegram.getChatMembersCount(CHANNEL_IDS[key]).then(count => ({ key, count }))));
    const subscriberMap = {};
    for (const r of memberResults) {
        if (r.status === 'fulfilled') subscriberMap[r.value.key] = r.value.count;
        else subscriberMap[r.reason?.key || '?'] = null;
    }
    const totalSubscribers = Object.values(subscriberMap).filter(v => v !== null).reduce((a, b) => a + b, 0);
    saveSubscriberSnapshot(subscriberMap);
    const statsData = loadStats();
    const snapshots = statsData.subscriberSnapshots || [];
    let subscriberGrowth = null;
    if (snapshots.length >= 2) {
        const latest = snapshots[snapshots.length - 1];
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const oldSnap = snapshots.slice().reverse().find(s => s.date <= cutoff);
        if (oldSnap) {
            const oldTotal = Object.values(oldSnap.counts).filter(Boolean).reduce((a,b)=>a+b,0);
            const newTotal = Object.values(latest.counts).filter(Boolean).reduce((a,b)=>a+b,0);
            subscriberGrowth = newTotal - oldTotal;
        }
    }
    const posts = statsData.posts || [];
    const totalPosts = posts.length;
    let totalViews = 0;
    for (const p of posts) for (const v of Object.values(p.views || {})) totalViews += (v || 0);
    let err = null;
    const recentPosts = posts.slice(-10);
    const recentViewsArr = recentPosts.map(p => Object.values(p.views || {}).reduce((a,b)=>a+b,0)).filter(v => v > 0);
    if (recentViewsArr.length > 0 && totalSubscribers > 0) {
        const avgViews = recentViewsArr.reduce((a,b)=>a+b,0) / recentViewsArr.length;
        err = ((avgViews / totalSubscribers) * 100).toFixed(1);
    }
    const fmt = n => n?.toLocaleString('ru-RU') ?? '—';
    let text = 'Статистика по всем каналам:\n\n';
    for (const key of activeChannels) {
        const cnt = subscriberMap[key];
        text += `${CHANNEL_LABELS[key]}: ${cnt !== null ? fmt(cnt) + ' подп.' : 'недоступно'}\n`;
    }
    text += `\n👥 Всего подписчиков: ${fmt(totalSubscribers)}\n`;
    if (subscriberGrowth !== null) {
        const sign = subscriberGrowth >= 0 ? '+' : '';
        text += `📈 Прирост за ~30 дней: ${sign}${fmt(subscriberGrowth)}\n`;
    } else {
        text += `📈 Прирост за ~30 дней: накапливается\n`;
    }
    text += `\n📝 Постов через бота: ${fmt(totalPosts)}\n`;
    text += `Просмотров: ${totalViews > 0 ? fmt(totalViews) : 'нехватает данных*'}\n`;
    text += `ERR: ${err !== null ? err + '%' : 'нехватает данных*'}\n`;
    if (totalViews === 0) text += `\n_* Просмотры накапливаются — /updateviews через 1 час после поста_`;
    return text;
}

async function refreshViews(ctx) {
    const data = loadStats();
    const recent = (data.posts || []).slice(-20);
    let updated = 0;
    for (const post of recent) {
        if (!post.messageIds) continue;
        for (const [key, msgId] of Object.entries(post.messageIds)) {
            const channelId = CHANNEL_IDS[key];
            if (!channelId) continue;
            try {
                const fwd = await bot.telegram.forwardMessage(ctx.chat.id, channelId, msgId);
                const views = fwd.views || fwd.forward_origin?.message?.views || 0;
                if (!post.views) post.views = {};
                post.views[key] = views;
                await bot.telegram.deleteMessage(ctx.chat.id, fwd.message_id);
                updated++;
            } catch {  }
        }
    }
    saveStats(data);
    return updated;
}

let sssTimer = null;

async function runSssCheck() {
    if (ADMIN_IDS.length === 0) return;
    if (!isSssEnabled()) return;
    try {
        const report = await buildSssReport();
        const admins = ADMIN_IDS.split(',').map(id => id.trim()).filter(Boolean);
        for (const adminId of admins) {
            try { await bot.telegram.sendMessage(adminId, report); } catch (err) {}
        }
    } catch (e) {}
}

function startSssScheduler() {
    if (sssTimer) return;
    sssTimer = setInterval(runSssCheck, SSS_CHECK_INTERVAL_MS);
}

function stopSssScheduler() {
    if (sssTimer) { clearInterval(sssTimer); sssTimer = null; }
}

bot.use(adminOnly);

bot.start(async ctx => {
    await ui(ctx, 'Выбери действие:', buildStartKeyboard());
});

bot.command('stat', async ctx => {
    await ui(ctx, 'Загружаю статистику...', bKb);
    try {
        const text = await buildStatText();
        await ui(ctx, text, { parse_mode: 'Markdown', reply_markup: bKb.reply_markup });
    } catch (e) {
        await ui(ctx, e.message, bKb);
    }
});

bot.command('updateviews', async ctx => {
    await ui(ctx, 'Обновляю просмотры...', bKb);
    try {
        const n = await refreshViews(ctx);
        await ui(ctx, `Обновлено просмотров для ${n} постов.`, bKb);
    } catch (e) {
        await ui(ctx, e.message, bKb);
    }
});

bot.command('post', async ctx => {
    Object.assign(ctx.session, defaultPostState());
    await ui(ctx, 'В какие каналы сделаем пост?', buildChannelKeyboard(ctx.session.channels));
});

bot.command('isdown', async ctx => {
    await ui(ctx, '🔍 Проверяю сайт...', bKb);
    try {
        const { ok, status } = await checkSite(SSS_SITE);
        const text = ok ? `🟢 ${SSS_SITE} — работает (HTTP ${status})` : `🔴 ${SSS_SITE} — недоступен (HTTP ${status ?? 'нет ответа'})`;
        await ui(ctx, text, bKb);
    } catch (e) {
        await ui(ctx, e.message, bKb);
    }
});

bot.command('checklive', async ctx => {
    await ui(ctx, '🔍 Собираю данные...', bKb);
    try {
        const report = await buildSssReport();
        await ui(ctx, report, bKb);
    } catch (e) {
        await ui(ctx, e.message, bKb);
    }
});

bot.action('cmd_stat', async ctx => {
    await ctx.answerCbQuery().catch(()=>{});
    await ui(ctx, '⏳ Загружаю статистику...', bKb);
    try {
        const text = await buildStatText();
        await ui(ctx, text, { parse_mode: 'Markdown', reply_markup: bKb.reply_markup });
    } catch (e) {
        await ui(ctx, e.message, bKb);
    }
});

bot.action('cmd_post', async ctx => {
    await ctx.answerCbQuery().catch(()=>{});
    Object.assign(ctx.session, defaultPostState());
    await ui(ctx, 'В какие каналы сделаем пост?', buildChannelKeyboard(ctx.session.channels));
});

bot.action('toggle_sss', async ctx => {
    await ctx.answerCbQuery().catch(()=>{});
    const newVal = !isSssEnabled();
    setSssEnabled(newVal);
    if (newVal) startSssScheduler();
    else stopSssScheduler();
    await ui(ctx, 'Выбери действие:', buildStartKeyboard());
});

CHANNEL_KEYS.forEach(key => {
    bot.action(`toggle_${key}`, async ctx => {
        await ctx.answerCbQuery().catch(()=>{});
        if (!ctx.session.channels) ctx.session.channels = defaultPostState().channels;
        ctx.session.channels[key] = !ctx.session.channels[key];
        await ui(ctx, 'В какие каналы сделаем пост?', buildChannelKeyboard(ctx.session.channels));
    });
});

bot.action('make_post', async ctx => {
    const channels = ctx.session.channels || {};
    const active = CHANNEL_KEYS.filter(k => channels[k]);
    if (active.length === 0) return ctx.answerCbQuery('Выбери хотя бы один канал!', { show_alert: true }).catch(()=>{});
    await ctx.answerCbQuery().catch(()=>{});
    ctx.session.awaiting_post_text = true;
    await ui(ctx, 'Отправь текст', bKb);
});

bot.on('text', async ctx => {
    if (!ctx.session?.awaiting_post_text) return;
    ctx.session.awaiting_post_text = false;
    const sourceText = ctx.message.text;
    const channels = ctx.session.channels || {};
    const activeKeys = CHANNEL_KEYS.filter(k => channels[k]);
    await ui(ctx, 'Перевожу и рассылаю...', bKb);
    const langList = activeKeys.join(', ');
    const systemPrompt = `Ты профессиональный переводчик. Пользователь даст текст. Тебе нужно перевести его ТОЛЬКО на следующие языки: ${langList}. Верни ответ строго в формате JSON, где ключи — коды языков (en, ua, ru, pl, de, main), значения — переведённый текст. Для 'ru' и 'main' оставь оригинальный текст. Никакого текста вне JSON.`;
    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: sourceText }],
            response_format: { type: 'json_object' },
        });
        let translations;
        try { translations = JSON.parse(completion.choices[0].message.content); } catch { return await ui(ctx, 'Ошибка парсинга JSON', bKb); }
        const postId = Date.now();
        const data = loadStats();
        data.posts.push({ id: postId, date: new Date().toISOString(), channels: activeKeys, text: sourceText.slice(0, 80), views: {}, messageIds: {} });
        saveStats(data);
        for (const key of activeKeys) {
            const text = translations[key];
            if (!text) continue;
            const channelId = CHANNEL_IDS[key];
            if (!channelId) continue;
            try {
                const sent = await bot.telegram.sendMessage(channelId, text);
                const fresh = loadStats();
                const post = fresh.posts.find(p => p.id === postId);
                if (post) { post.messageIds[key] = sent.message_id; saveStats(fresh); }
            } catch (sendErr) {}
        }
        await ui(ctx, 'через 1 час запусти /updateviews — бот подтянет просмотры для статистики.', bKb);
    } catch (err) {
        await ui(ctx, 'Ошибка OpenAI', bKb);
    }
});

bot.launch().then(() => {
    if (isSssEnabled()) startSssScheduler();
}).catch(() => { process.exit(1); });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));