require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');



if (!process.env.BOT_TOKEN) { console.error('err 33:1 / BOT_TOKEN is missing in .env'); process.exit(1); }
if (!process.env.OPENAI_API_KEY) { console.error('err 33:2 / OPENAI_API_KEY is missing in .env'); process.exit(1); }



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



const STATS_FILE = path.join(__dirname, 'stats.json');

function loadStats() {
    if (!fs.existsSync(STATS_FILE)) return { posts: [], subscriberSnapshots: [] };
    try { return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); }
    catch { return { posts: [], subscriberSnapshots: [] }; }
}

function saveStats(data) {
    fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2));
}


function recordPost(channelKeys, text) {
    const data = loadStats();
    data.posts.push({
        id: Date.now(),
        date: new Date().toISOString(),
        channels: channelKeys,
        text: text.slice(0, 80),   
        views: {},                  
    });
    saveStats(data);
}


function recordPostMessageId(postId, channelKey, messageId) {
    const data = loadStats();
    const post = data.posts.find(p => p.id === postId);
    if (!post) return;
    if (!post.messageIds) post.messageIds = {};
    post.messageIds[channelKey] = messageId;
    saveStats(data);
}


function saveSubscriberSnapshot(counts) {
    const data = loadStats();
    const today = new Date().toISOString().slice(0, 10);
    
    data.subscriberSnapshots = (data.subscriberSnapshots || [])
        .filter(s => s.date !== today)
        .slice(-59);
    data.subscriberSnapshots.push({ date: today, counts });
    saveStats(data);
}



const CHANNEL_LABELS = { en: 'EN', ua: 'UA', ru: 'RU', pl: 'PL', de: 'DE', main: 'Main' };
const CHANNEL_KEYS = Object.keys(CHANNEL_LABELS);

function defaultPostState() {
    return {
        channels: { en: false, ua: false, ru: false, pl: false, de: false, main: false },
        awaiting_post_text: false,
    };
}

function buildChannelKeyboard(channels) {
    const rows = CHANNEL_KEYS.map(key => {
        const label = `${channels[key] ? '➕ ' : ''}${CHANNEL_LABELS[key]}`;
        return [Markup.button.callback(label, `toggle_${key}`)];
    });
    rows.push([Markup.button.callback('Запостить', 'make_post')]);
    return Markup.inlineKeyboard(rows);
}

function buildStartKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Пост в ТГК', 'cmd_post')],
        [Markup.button.callback('Статистика', 'cmd_stat')],
    ]);
}



async function buildStatText() {
    const activeChannels = CHANNEL_KEYS.filter(k => CHANNEL_IDS[k]);

    
    const memberResults = await Promise.allSettled(
        activeChannels.map(key =>
            bot.telegram.getChatMembersCount(CHANNEL_IDS[key])
                .then(count => ({ key, count }))
        )
    );

    const subscriberMap = {};   
    for (const r of memberResults) {
        if (r.status === 'fulfilled') subscriberMap[r.value.key] = r.value.count;
        else subscriberMap[r.reason?.key || '?'] = null;
    }

    const totalSubscribers = Object.values(subscriberMap)
        .filter(v => v !== null)
        .reduce((a, b) => a + b, 0);

    
    saveSubscriberSnapshot(subscriberMap);

    const statsData = loadStats();
    const snapshots = statsData.subscriberSnapshots || [];
    let subscriberGrowth = null;

    if (snapshots.length >= 2) {
        const latest = snapshots[snapshots.length - 1];
        
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const oldSnap = snapshots.slice().reverse().find(s => s.date <= cutoff);
        if (oldSnap) {
            const oldTotal = Object.values(oldSnap.counts).filter(Boolean).reduce((a, b) => a + b, 0);
            const newTotal = Object.values(latest.counts).filter(Boolean).reduce((a, b) => a + b, 0);
            subscriberGrowth = newTotal - oldTotal;
        }
    }

    
    const posts = statsData.posts || [];
    const totalPosts = posts.length;

    
    let totalViews = 0;
    for (const p of posts) {
        for (const v of Object.values(p.views || {})) totalViews += (v || 0);
    }

    
    
    let err = null;
    const recentPosts = posts.slice(-10);
    const recentViewsArr = recentPosts
        .map(p => Object.values(p.views || {}).reduce((a, b) => a + b, 0))
        .filter(v => v > 0);

    if (recentViewsArr.length > 0 && totalSubscribers > 0) {
        const avgViews = recentViewsArr.reduce((a, b) => a + b, 0) / recentViewsArr.length;
        err = ((avgViews / totalSubscribers) * 100).toFixed(1);
    }

    
    const fmt = n => n?.toLocaleString('ru-RU') ?? '—';

    let text = '    Статистика по всем каналам:\n\n';

    
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

    if (totalViews === 0) {
        text += `\n_* Просмотры накапливаются — /updateviews через 1 час после поста_`;
    }

    return text;
}






async function refreshViews(ctx) {
    const data = loadStats();
    const posts = data.posts || [];
    const recent = posts.slice(-20);   
    let updated = 0;

    for (const post of recent) {
        if (!post.messageIds) continue;
        for (const [key, msgId] of Object.entries(post.messageIds)) {
            const channelId = CHANNEL_IDS[key];
            if (!channelId) continue;
            try {
                
                const fwd = await bot.telegram.forwardMessage(
                    ctx.chat.id,
                    channelId,
                    msgId
                );
                const views = fwd.views || fwd.forward_origin?.message?.views || 0;
                if (!post.views) post.views = {};
                post.views[key] = views;
                
                await bot.telegram.deleteMessage(ctx.chat.id, fwd.message_id);
                updated++;
            } catch (e) {
                
            }
        }
    }

    saveStats(data);
    return updated;
}



bot.start(async ctx => {
    await ctx.reply('Выбери действие:', buildStartKeyboard());
});

bot.command('stat', async ctx => {
    const msg = await ctx.reply('Загружаю статистику...');
    try {
        const text = await buildStatText();
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, text, { parse_mode: 'Markdown' });
    } catch (e) {
        await ctx.reply('err 33:3 / ' + e.message);
    }
});

bot.command('updateviews', async ctx => {
    const msg = await ctx.reply('Обновляю просмотры...');
    try {
        const n = await refreshViews(ctx);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
            `Обновлено просмотров для ${n} постов.`);
    } catch (e) {
        await ctx.reply('err 33:4 / ' + e.message);
    }
});

bot.command('post', async ctx => {
    Object.assign(ctx.session, defaultPostState());
    await ctx.reply('В какие каналы сделаем пост?', buildChannelKeyboard(ctx.session.channels));
});



bot.action('cmd_stat', async ctx => {
    await ctx.answerCbQuery();
    const msg = await ctx.reply('⏳ Загружаю статистику...');
    try {
        const text = await buildStatText();
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, text, { parse_mode: 'Markdown' });
    } catch (e) {
        await ctx.reply('err 33:5 / Ошибка: ' + e.message);
    }
});

bot.action('cmd_post', async ctx => {
    await ctx.answerCbQuery();
    Object.assign(ctx.session, defaultPostState());
    await ctx.reply('В какие каналы сделаем пост?', buildChannelKeyboard(ctx.session.channels));
});

CHANNEL_KEYS.forEach(key => {
    bot.action(`toggle_${key}`, async ctx => {
        await ctx.answerCbQuery();
        if (!ctx.session.channels) ctx.session.channels = defaultPostState().channels;
        ctx.session.channels[key] = !ctx.session.channels[key];
        try {
            await ctx.editMessageReplyMarkup(buildChannelKeyboard(ctx.session.channels).reply_markup);
        } catch (e) {  }
    });
});

bot.action('make_post', async ctx => {
    const channels = ctx.session.channels || {};
    const active = CHANNEL_KEYS.filter(k => channels[k]);
    if (active.length === 0) {
        return ctx.answerCbQuery('Выбери хотя бы один канал!', { show_alert: true });
    }
    await ctx.answerCbQuery();
    ctx.session.awaiting_post_text = true;
    await ctx.reply('Отправь текст для поста. Я переведу его для выбранных каналов.');
});



bot.on('text', async ctx => {
    if (!ctx.session.awaiting_post_text) return;

    ctx.session.awaiting_post_text = false;

    const sourceText = ctx.message.text;
    const channels = ctx.session.channels || {};
    const activeKeys = CHANNEL_KEYS.filter(k => channels[k]);

    await ctx.reply('⏳ Перевожу и рассылаю...');

    const langList = activeKeys.join(', ');
    const systemPrompt =
        `Ты профессиональный переводчик. Пользователь даст текст. ` +
        `Тебе нужно перевести его ТОЛЬКО на следующие языки: ${langList}. ` +
        `Верни ответ строго в формате JSON, где ключи — коды языков ` +
        `(en, ua, ru, pl, de, main), значения — переведённый текст. ` +
        `Для 'ru' и 'main' оставь оригинальный текст. Никакого текста вне JSON.`;

    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: sourceText },
            ],
            response_format: { type: 'json_object' },
        });

        let translations;
        try {
            translations = JSON.parse(completion.choices[0].message.content);
        } catch {
            await ctx.reply('err 33:6 / Не удалось разобрать ответ от OpenAI. Попробуй ещё раз.');
            return;
        }

        
        const postId = Date.now();
        const data = loadStats();
        data.posts.push({
            id: postId,
            date: new Date().toISOString(),
            channels: activeKeys,
            text: sourceText.slice(0, 80),
            views: {},
            messageIds: {},
        });
        saveStats(data);

        
        for (const key of activeKeys) {
            const text = translations[key];

            if (!text) {
                await ctx.reply(`err 33:7 / Перевод для ${CHANNEL_LABELS[key]} не получен, пропускаем.`);
                continue;
            }

            const channelId = CHANNEL_IDS[key];
            if (!channelId) {
                await ctx.reply(`err 33:8 / CHANNEL_${key.toUpperCase()} не задан в .env, пропускаем.`);
                continue;
            }

            try {
                const sent = await bot.telegram.sendMessage(channelId, text);
                
                const fresh = loadStats();
                const post = fresh.posts.find(p => p.id === postId);
                if (post) {
                    post.messageIds[key] = sent.message_id;
                    saveStats(fresh);
                }
                await ctx.reply(`Отправлено в ${CHANNEL_LABELS[key]}`);
            } catch (sendErr) {
                console.error(`err 33:9 / Send error [${key}]:`, sendErr.message);
                await ctx.reply(`err 33:10 / Ошибка отправки в ${CHANNEL_LABELS[key]}: ${sendErr.message}`);
            }
        }

        await ctx.reply('через 1 час запусти /updateviews — бот подтянет просмотры для статистики.');

    } catch (err) {
        console.error('err 33:11 / OpenAI error:', err);
        await ctx.reply('err 33:12 / Ошибка при обращении к OpenAI. Попробуй позже.');
    }
});



bot.launch()
    .then(() => console.log('Bot started'))
    .catch(err => { console.error('err 33:13 / Failed to start:', err.message); process.exit(1); });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));