const path = require('path');
const fs = require('fs');
const { fileTypeFromBuffer } = require('file-type');
const {
    default: _makeWaSocket,
    proto,
    downloadContentFromMessage,
    jidDecode,
    areJidsSameUser
} = require('@whiskeysockets/baileys');

function makeWASocket(connectionOptions, options = {}) {
    let conn = _makeWaSocket(connectionOptions);

    conn.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            const decode = jidDecode(jid) || {};
            return (decode.user && decode.server && decode.user + '@' + decode.server) || jid;
        } else return jid;
    };

    conn.reply = (jid, text, m, options) => {
        return conn.sendMessage(jid, { text: text }, { quoted: m, ...options });
    };

    conn.getFile = async (PATH, saveToFile = false) => {
        let res, filename;
        const data = Buffer.isBuffer(PATH)
            ? PATH
            : PATH instanceof ArrayBuffer
                ? Buffer.from(PATH)
                : /^data:.*?\/.*?;base64,/i.test(PATH)
                    ? Buffer.from(PATH.split`,`[1], 'base64')
                    : /^https?:\/\//.test(PATH)
                        ? (res = await fetch(PATH), Buffer.from(await res.arrayBuffer()))
                        : fs.existsSync(PATH)
                            ? (filename = PATH, fs.readFileSync(PATH))
                            : typeof PATH === 'string'
                                ? Buffer.from(PATH)
                                : Buffer.alloc(0);
        if (!Buffer.isBuffer(data)) throw new TypeError('Result is not a buffer');
        const type = await fileTypeFromBuffer(data) || { mime: 'application/octet-stream', ext: '.bin' };
        if (data && saveToFile && !filename) {
            const tmpDir = './tmp';
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
            filename = path.join(tmpDir, `${Date.now()}.${type.ext}`);
            fs.writeFileSync(filename, data);
        }
        return {
            res,
            filename,
            ...type,
            data,
            deleteFile() {
                return filename && fs.unlinkSync(filename);
            }
        };
    };

    conn.sendFile = async (jid, path, filename = '', caption = '', quoted, ptt = false, options = {}) => {
        let type = await conn.getFile(path, true);
        let { res, data: file, filename: pathFile } = type;
        if (res?.status !== 200 || file.length <= 65536) {
            try { throw { json: JSON.parse(file.toString()) }; }
            catch (e) { if (e.json) throw e.json; }
        }
        const fileSize = fs.statSync(pathFile).size / 1024 / 1024;
        if (fileSize >= 100) throw new Error('File size is too big!');
        let opt = {};
        if (quoted) opt.quoted = quoted;
        if (!type) options.asDocument = true;
        let mtype = '', mimetype = options.mimetype || type.mime;
        if (/webp/.test(type.mime) || (/image/.test(type.mime) && options.asSticker)) mtype = 'sticker';
        else if (/image/.test(type.mime) || (/webp/.test(type.mime) && options.asImage)) mtype = 'image';
        else if (/video/.test(type.mime)) mtype = 'video';
        else if (/audio/.test(type.mime)) mtype = 'audio';
        else mtype = 'document';
        if (options.asDocument) mtype = 'document';

        let message = {
            ...options,
            caption,
            ptt,
            [mtype]: { url: pathFile },
            mimetype,
            fileName: filename || pathFile.split('/').pop()
        };
        let m;
        try {
            m = await conn.sendMessage(jid, message, { ...opt, ...options });
        } catch (e) {
            m = null;
        } finally {
            if (!m) m = await conn.sendMessage(jid, { ...message, [mtype]: file }, { ...opt, ...options });
            return m;
        }
    };

    conn.downloadM = async (m, type, saveToFile) => {
        let M = m.msg || m;
        let mtype = M.mtype ? M.mtype.replace(/Message/i, '') : type;
        let message = M.message ? M.message[mtype] : M;
        let stream = await downloadContentFromMessage(message, mtype);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        if (saveToFile) {
            let ran = Math.floor(Math.random() * 100000);
            let ext = message.mimetype.split('/')[1];
            let filename = path.join('./tmp', `${ran}.${ext}`);
            fs.writeFileSync(filename, buffer);
            return filename;
        }
        return buffer;
    };

    return conn;
}

async function smsg(conn, m) {
    if (!m) return m;
    if (m.key) {
        m.id = m.key.id;
        m.isBaileys = m.id.startsWith('BAE5') && m.id.length === 16;
        m.chat = m.key.remoteJid;
        m.fromMe = m.key.fromMe;
        m.isGroup = m.chat.endsWith('@g.us');
        m.sender = conn.decodeJid(m.fromMe && conn.user.id || m.participant || m.key.participant || m.chat || '');

        if (m.sender.endsWith('@lid')) {
            if (conn.resolveLidToJid) {
                m.sender = await conn.resolveLidToJid(m.sender);
            }
        }

        if (m.chat.endsWith('@lid') && !m.isGroup) {
            if (conn.resolveLidToJid) {
                m.chat = await conn.resolveLidToJid(m.chat);
            }
        }
    }
    if (m.message) {
        m.mtype = Object.keys(m.message)[0];
        m.msg = m.message[m.mtype];
        if (m.mtype === 'viewOnceMessageV2') {
            m.msg = m.message.viewOnceMessageV2.message;
            m.mtype = Object.keys(m.msg)[0];
            m.msg = m.msg[m.mtype];
        }
        let text = m.msg.text || m.msg.caption || m.message.conversation || m.msg.contentText || m.msg.selectedDisplayText || m.msg.title || '';
        m.text = typeof m.msg === 'string' ? m.msg : text;
        m.download = (saveToFile = false) => conn.downloadM(m, m.mtype.replace(/Message/i, ''), saveToFile);

        let quoted = m.quoted = m.msg.contextInfo ? m.msg.contextInfo.quotedMessage : null;
        if (m.quoted) {
            let type = Object.keys(m.quoted)[0];
            let quotedMsg = m.quoted[type];
            if (!quotedMsg) {
                m.quoted = null;
            } else {
                m.quoted = quotedMsg;
                if (typeof m.quoted === 'string') m.quoted = { text: m.quoted };
                m.quoted.mtype = type;
                m.quoted.id = m.msg.contextInfo.stanzaId;
                m.quoted.chat = m.msg.contextInfo.remoteJid || m.chat;
                m.quoted.sender = conn.decodeJid(m.msg.contextInfo.participant);

                if (m.quoted.sender && m.quoted.sender.endsWith('@lid')) {
                    if (conn.resolveLidToJid) {
                        m.quoted.sender = await conn.resolveLidToJid(m.quoted.sender);
                    }
                }

                if (m.quoted.chat && m.quoted.chat.endsWith('@lid') && !m.isGroup) {
                    if (conn.resolveLidToJid) {
                        m.quoted.chat = await conn.resolveLidToJid(m.quoted.chat);
                    }
                }

                m.quoted.fromMe = areJidsSameUser(m.quoted.sender, conn.decodeJid(conn.user.id));
                m.quoted.text = m.quoted.text || m.quoted.caption || '';
                m.quoted.reply = (text, chatId, options) => conn.reply(chatId ? chatId : m.chat, text, m.quoted, options);
                m.quoted.download = (saveToFile = false) => conn.downloadM(m.quoted, m.quoted.mtype.replace(/Message/i, ''), saveToFile);
            }
        }
    }
    m.reply = (text, chatId, options) => conn.reply(chatId ? chatId : m.chat, text, m, options);
    return m;
}

function bind(conn) {
    if (!conn.chats) conn.chats = {};
    if (!conn.contacts) conn.contacts = {};

    function updateNameToDb(contacts) {
        if (!contacts) return;
        try {
            contacts = contacts.contacts || contacts;
            for (const contact of contacts) {
                const id = conn.decodeJid(contact.id);
                if (!id || id === 'status@broadcast') continue;

                let chats = conn.chats[id];
                if (!chats) chats = conn.chats[id] = { ...contact, id };
                conn.chats[id] = {
                    ...chats,
                    ...contact,
                    ...(id.endsWith('@g.us') ?
                        { subject: contact.subject || contact.name || chats.subject || '' } :
                        { name: contact.notify || contact.name || chats.name || chats.notify || '' })
                };

                conn.contacts[id] = {
                    ...conn.contacts[id],
                    ...contact
                };
            }
        } catch (e) {}
    }

    conn.ev.on('contacts.upsert', updateNameToDb);
    conn.ev.on('contacts.update', updateNameToDb);
    conn.ev.on('contacts.set', updateNameToDb);
    conn.ev.on('groups.update', updateNameToDb);

    conn.ev.on('messages.reaction', (reactions) => {
        try {
            for (const reaction of reactions) {
                if (reaction.key?.participant) {
                    const jid = conn.decodeJid(reaction.key.participant);
                    if (jid && !conn.contacts[jid]) {
                        conn.contacts[jid] = { id: jid };
                    }
                }
            }
        } catch (e) {}
    });

    conn.ev.on('chats.set', async ({ chats }) => {
        try {
            for (let { id, name, readOnly } of chats) {
                id = conn.decodeJid(id);
                if (!id || id === 'status@broadcast') continue;
                const isGroup = id.endsWith('@g.us');
                let localChats = conn.chats[id];
                if (!localChats) localChats = conn.chats[id] = { id };
                localChats.isChats = !readOnly;
                if (name) localChats[isGroup ? 'subject' : 'name'] = name;
                if (isGroup) {
                    const metadata = await conn.groupMetadata(id).catch(_ => null);
                    if (name || metadata?.subject) localChats.subject = name || metadata.subject;
                    if (!metadata) continue;
                    localChats.metadata = metadata;
                }
            }
        } catch (e) {}
    });

    conn.ev.on('group-participants.update', async function updateParticipantsToDb({ id, participants, action }) {
        if (!id) return;
        id = conn.decodeJid(id);
        if (id === 'status@broadcast') return;
        if (!(id in conn.chats)) conn.chats[id] = { id };
        let localChats = conn.chats[id];
        localChats.isChats = true;
        const groupMetadata = await conn.groupMetadata(id).catch(_ => null);
        if (!groupMetadata) return;
        localChats.subject = groupMetadata.subject;
        localChats.metadata = groupMetadata;
    });

    if (conn.user) {
        conn.contacts[conn.user.id] = {
            id: conn.user.id,
            name: conn.user.name,
            notify: conn.user.name
        };
    }
}

module.exports = { makeWASocket, smsg, bind };