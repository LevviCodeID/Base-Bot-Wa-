/*
━━━━━━━━━━━━━━━━━━━━
     LEVVICODE LICENSE
━━━━━━━━━━━━━━━━━━━━

Base Name : LevviCode Base Bot
Developer : LevviCode
Telegram  : t.me/lepicode

[ LICENSE RULES ]

1. DILARANG HAPUS CREDIT
- Credit developer wajib ada
- Nama "LevviCode" tidak boleh dihapus
- Dilarang claim full script milik sendiri

2. DIPERBOLEHKAN
✔ Rename nama bot
✔ Edit tampilan/menu
✔ Tambah fitur
✔ Fix bug
✔ Recode untuk kebutuhan pribadi

3. DILARANG
✘ Jual ulang source tanpa izin
✘ Share base private/premium
✘ Encrypt lalu dijual kembali
✘ Hapus watermark developer

4. HAK PENGGUNA
- Bebas memakai base untuk bot pribadi
- Boleh open jasa run
- Boleh open panel / jasa install
- Tidak boleh resell source tanpa izin

5. PELANGGARAN
- Tidak mendapat update
- Tidak mendapat support
- License dianggap hangus

Dengan memakai base ini,
anda dianggap setuju dengan
seluruh aturan di atas.

© LevviCode - All Rights Reserved
━━━━━━━━━━━━━━━━━━━━
*/
const baileys = require('@whiskeysockets/baileys')

const {
    default: makeWASocket,
    proto,
    generateWAMessageFromContent,
    generateWAMessage,
    generateWAMessageContent,
    prepareWAMessageMedia,
    downloadContentFromMessage,
    downloadAndSaveMediaMessage,
    jidNormalizedUser,
    getContentType,
    fetchLatestBaileysVersion,
    useSingleFileAuthState,
    makeInMemoryStore,
    DisconnectReason,
    Browsers
} = baileys

const os = require('os');
const util = require('util');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp')
const { exec } = require('child_process');
const { fileTypeFromBuffer } = require('file-type');
const { writeExif } = require('./lib/StickerMaker.js');

const config = require('./config.json');
const ownerPath = path.join(__dirname, 'database', 'owner.json');
const premiumPath = path.join(__dirname, 'database', 'premium.json');

const readJSON = (file) => {
    try {
        if (!fs.existsSync(file)) fs.writeFileSync(file, '[]');
        return JSON.parse(fs.readFileSync(file));
    } catch {
        return [];
    }
};

const saveJSON = (file, data) => {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

const getNumber = (jid = '') => String(jid).split('@')[0].replace(/\D/g, '');

const isCreator = (m) => {
    const sender = getNumber(m.sender);
    const creator = String(config.ownerNumber || '').replace(/\D/g, '');
    return sender === creator;
};

const isOwner = (m) => {
    const sender = getNumber(m.sender);
    const ownerDB = readJSON(ownerPath);
    const creator = String(config.ownerNumber || '').replace(/\D/g, '');
    return sender === creator || ownerDB.includes(sender);
};

const isPremium = (m) => {
    const sender = getNumber(m.sender);
    const premiumDB = readJSON(premiumPath);
    return isOwner(m) || premiumDB.includes(sender);
};

// System executeEval
const executeEval = async (code, conn, m) => {
    try {
        let result

        if (code.includes('\n') || code.includes(';')) {
            result = await eval(`
                (async (conn, m, require, fs, util) => {
                    ${code}
                })(conn, m, require, fs, util)
            `)
        } else {
            result = await eval(`
                (async (conn, m, require, fs, util) => {
                    return (${code})
                })(conn, m, require, fs, util)
            `)
        }

        if (typeof result !== 'string') {
            result = util.inspect(result, {
                depth: 1
            })
        }

        m.reply(result || 'undefined')
    } catch (e) {
        m.reply(String(e))
    }
}

//System Detect id all Button, id button gapake titik (.)
const extractCommandFromMessage = (m) => {
    let body = '';
    let isButtonResponse = false;
    try {
        if (m.message) {
            if (m.message.conversation) body = m.message.conversation;
            else if (m.message.extendedTextMessage?.text) body = m.message.extendedTextMessage.text;
            else if (m.message.imageMessage?.caption) body = m.message.imageMessage.caption;
            else if (m.message.videoMessage?.caption) body = m.message.videoMessage.caption;
            else if (m.message.documentMessage?.caption) body = m.message.documentMessage.caption;
            else if (m.message.interactiveResponseMessage) {
                const inter = m.message.interactiveResponseMessage;
                if (inter.nativeFlowResponseMessage) {
                    const flow = inter.nativeFlowResponseMessage;
                    if (flow.paramsJson) {
                        try {
                            const params = JSON.parse(flow.paramsJson);
                            body = params.id || params.buttonId || params.rowId || params.index || '';
                        } catch { body = flow.name || ''; }
                    } else body = flow.name || '';
                    isButtonResponse = true;
                } else if (inter.buttonReply) {
                    body = inter.buttonReply.selectedButtonId || '';
                    isButtonResponse = true;
                } else if (inter.singleSelectReply) {
                    body = inter.singleSelectReply.selectedRowId || '';
                    isButtonResponse = true;
                }
            } else if (m.message.templateButtonReplyMessage) {
                body = m.message.templateButtonReplyMessage.selectedId || '';
                isButtonResponse = true;
            } else if (m.message.buttonsResponseMessage) {
                body = m.message.buttonsResponseMessage.selectedButtonId || '';
                isButtonResponse = true;
            }
        }
    } catch (error) {
        console.error('Error parsing message:', error);
    }
    return { body, isButtonResponse };
};




module.exports = async (conn, m) => {
    try {
        const { body, isButtonResponse } = extractCommandFromMessage(m);
        if (!body) return;
        if (body) m.text = body;

        let command = '';
        let args = [];

        if (isButtonResponse) {
            const parts = body.split(/ +/);
            command = parts[0].toLowerCase();
            args = parts.slice(1);
        } else {
            const trimmed = body.trim();
            if (trimmed.startsWith(']>')) {
                if (!isCreator(m)) return m.reply('Perintah eval hanya untuk creator.');
                const evalCode = trimmed.slice(2).trim();
                if (!evalCode) return m.reply('Contoh:\n]> 1+1');
                return await executeEval(evalCode, conn, m);
            }
            if (trimmed.startsWith('$')) {
                if (!isCreator(m)) return m.reply('❌ Perintah shell hanya untuk creator.');
                const shellCmd = trimmed.slice(1).trim();
                if (!shellCmd) return m.reply('Contoh: $ ls -la');
                m.reply('⏳ Menjalankan perintah shell...');
                exec(shellCmd, { timeout: 30000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
                    let output = stdout || stderr || error?.message || '✅ Selesai (tidak ada output)';
                    if (output.length > 2000) output = output.slice(0, 2000) + '\n... (output dipotong)';
                    m.reply(`💻 Output:\n${output}`);
                });
                return;
            }
            if (body.startsWith(config.prefix || '.')) {
                const cleanBody = body.slice(1).trim();
                const parts = cleanBody.split(/ +/);
                command = parts[0].toLowerCase();
                args = parts.slice(1);
            } else {
                return;
            }
        }

        const { reply } = m;

        const thumb = await sharp('./src/img/menu.jpg')
        .resize(300, 300)
        .jpeg({ quality: 80 })
        .toBuffer()

       // Self
       if (config.mode === 'self' && !isCreator(m)) return
       //Case
        switch (command) {

        case 'menu': {
    const runtime = process.uptime()

    const days = Math.floor(runtime / 86400)
    const hours = Math.floor((runtime % 86400) / 3600)
    const minutes = Math.floor((runtime % 3600) / 60)
    const seconds = Math.floor(runtime % 60)

    const ping = Date.now() - (Number(m.messageTimestamp) * 1000)
    const mode = config.mode === 'self' ? 'SELF' : 'PUBLIC'

    await conn.relayMessage(
        m.chat,
        {
            buttonsMessage: {
                locationMessage: {
                    degreesLatitude: 0,
                    degreesLongitude: 0,
                    name: 'LevviCode',
                    address: 'LevviCode',
                    jpegThumbnail: thumb
                },
contentText: `
┏━━━〔 INFO BOT 〕━━━⬣
┃
┃❍ Nama Bot : LevviCode Base Bot
┃❍ Developer : LevviCode
┃❍ Tele : t.me/lepicode
┃❍ Type : Case
┃❍ Mode : ${mode}
┃❍ Number : ${String(m.sender).replace(/@.+/g, '')}
┃❍ Ping : ${Math.floor(ping)} ms
┃❍ Runtime : ${days}H ${hours}J ${minutes}M ${seconds}D
┃
┗━━━━━━━━━━━━━━⬣

Klik tombol di bawah untuk melihat semua menu.`,
                footerText: 'LevviCode Bot',
                buttons: [
                    {
                        buttonId: 'allmenu',
                        buttonText: {
                            displayText: 'All Menu'
                        },
                        type: 1
                    }
                ],
                headerType: 6
            }
        },
        {
            quoted: m,
            messageId: conn.generateMessageTag()
        }
    )
    break
}

        case 'allmenu': {
            await conn.relayMessage(
        m.chat,
        {
            buttonsMessage: {
                locationMessage: {
                    degreesLatitude: 0,
                    degreesLongitude: 0,
                    name: 'LevviCode',
                    address: 'LevviCode',
                    jpegThumbnail: thumb
                },
                contentText: `*ALL MENU*

MAIN MENU
• menu
• ping
• info
• owner
• myjid

STICKER MENU
• sticker
• s

OWNER MENU
• addowner
• delowner
• addprem
• delprem
• eval`,
                footerText: 'LevviCode Bot',
                buttons: [
                    {
                        buttonId: 'menu',
                        buttonText: {
                            displayText: 'Back Menu'
                        },
                        type: 1
                    },
                    {
                        buttonId: 'owner',
                        buttonText: {
                            displayText: 'Owner Menu'
                        },
                        type: 1
                    }
                ],
                headerType: 6
            }
        },
        {
            quoted: m,
            messageId: conn.generateMessageTag()
        }
    )
    break
}

            case 'owner':
            case 'cekowner': {
                const creator = isCreator(m);
                const owner = isOwner(m);
                const status = creator ? '👑 Kamu adalah CREATOR' : owner ? '✅ Kamu adalah OWNER' : '❌ Kamu bukan owner';
                const info = `JID mu: ${m.sender}\nCreator: ${config.ownerNumber}@s.whatsapp.net`;
                await reply(`${status}\n\n${info}`);
                break;
            }

            case 'myjid':
                await reply(`JID kamu: ${m.sender}`);
                break;

            case 'ping': {
                const start = Date.now();
                const sent = await reply('Mengukur ping...');
                const latency = Date.now() - start;
                const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
                const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
                const uptimeHours = (os.uptime() / 3600).toFixed(2);
                const cpuModel = os.cpus()[0]?.model || 'Unknown';
                const cpuCores = os.cpus().length;
                const vpsText = `DATA VPS\n- Hostname: ${os.hostname()}\n- Platform: ${os.platform()} ${os.arch()}\n- Uptime: ${uptimeHours} jam\n- RAM: ${freeMem} GB / ${totalMem} GB (Free/Total)\n- CPU: ${cpuCores} Core, ${cpuModel.substring(0, 30)}`;
                await conn.sendMessage(m.chat, { text: `Pong! ${latency} ms\n\n${vpsText}`, edit: sent.key });
                break;
            }

            case 'info': {  
                await reply(`INFO PESAN\n\nJID Pengirim: ${m.sender}\nJID Chat: ${m.chat}\nGrup: ${m.isGroup ? 'Ya' : 'Tidak'}\nDari Bot: ${m.fromMe ? 'Ya' : 'Tidak'}\nID Pesan: ${m.id || '-'}\nTeks: ${m.text || '-'}`);
                break;
            }

            case 'sticker':
            case 's': {
                if (!m.quoted && !args[0]) return reply('Reply gambar/video atau kirim URL dengan .sticker <url>');
                let mediaBuffer;
                if (m.quoted && (m.quoted.mtype === 'imageMessage' || m.quoted.mtype === 'videoMessage')) {
                    mediaBuffer = await m.quoted.download();
                } else if (args[0] && args[0].match(/https?:\/\//)) {
                    const res = await fetch(args[0]);
                    mediaBuffer = Buffer.from(await res.arrayBuffer());
                } else return reply('Format tidak dikenal. Reply media atau kirim URL.');
                if (!mediaBuffer) return reply('Gagal mengambil media.');
                const type = await fileTypeFromBuffer(mediaBuffer);
                if (!type || (!/image/.test(type.mime) && !/video/.test(type.mime))) return reply('Hanya gambar atau video yang didukung.');
                await reply('Membuat stiker...');
                try {
                    const stickerBuffer = await writeExif(mediaBuffer, { packname: 'Sticker Bot', author: 'LevviCode', cropToSquare: false });
                    await conn.sendMessage(m.chat, { sticker: stickerBuffer }, { quoted: m });
                } catch (err) {
                    console.error(err);
                    await reply('Gagal membuat stiker: ' + err.message);
                }
                break;
            }

            case 'addowner': {
                if (!isCreator(m)) return reply('Khusus creator');
                let target = args[0];
                if (m.mentionedJid?.[0]) target = m.mentionedJid[0];
                if (!target) return reply('Contoh: .addowner 628xxx');
                const ownerDB = readJSON(ownerPath);
                const num = getNumber(target);
                if (ownerDB.includes(num)) return reply('Sudah jadi owner');
                ownerDB.push(num);
                saveJSON(ownerPath, ownerDB);
                reply(`Berhasil add owner\n${num}`);
                break;
            }

            case 'delowner': {
                if (!isCreator(m)) return reply('Khusus creator');
                let target = args[0];
                if (m.mentionedJid?.[0]) target = m.mentionedJid[0];
                if (!target) return reply('Contoh: .delowner 628xxx');
                const ownerDB = readJSON(ownerPath);
                const num = getNumber(target);
                const filtered = ownerDB.filter(v => v !== num);
                saveJSON(ownerPath, filtered);
                reply(`Berhasil del owner\n${num}`);
                break;
            }

            case 'addprem': {
                if (!isOwner(m)) return reply('Khusus owner');
                let target = args[0];
                if (m.mentionedJid?.[0]) target = m.mentionedJid[0];
                if (!target) return reply('Contoh: .addprem 628xxx');
                const premiumDB = readJSON(premiumPath);
                const num = getNumber(target);
                if (premiumDB.includes(num)) return reply('Sudah premium');
                premiumDB.push(num);
                saveJSON(premiumPath, premiumDB);
                reply(`Berhasil add premium\n${num}`);
                break;
            }

            case 'delprem': {
                if (!isOwner(m)) return reply('Khusus owner');
                let target = args[0];
                if (m.mentionedJid?.[0]) target = m.mentionedJid[0];
                if (!target) return reply('Contoh: .delprem 628xxx');
                const premiumDB = readJSON(premiumPath);
                const num = getNumber(target);
                const filtered = premiumDB.filter(v => v !== num);
                saveJSON(premiumPath, filtered);
                reply(`Berhasil del premium\n${num}`);
                break;
            }

            case 'eval': {
                if (!isCreator(m)) return reply('Khusus creator');
                const code = args.join(' ');
                if (!code) return reply('Contoh:\n.eval 1+1');
                await executeEval(code, conn, m);
                break;
            }
            
           case 'public': {
    if (!isOwner(m)) return reply('Khusus owner')

    config.mode = 'public'
    fs.writeFileSync('./config.json', JSON.stringify(config, null, 2))

    reply('Berhasil ganti mode ke public')
}
           break

           case 'self': {
    if (!isOwner(m)) return reply('Khusus owner')

    config.mode = 'self'
    fs.writeFileSync('./config.json', JSON.stringify(config, null, 2))

    reply('Berhasil ganti mode ke self')
}
           break
           
           
            default:
                break;
        }
    } catch (err) {
        console.error('Error in command handler:', err);
    }
};