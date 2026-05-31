const fs = require('fs')
const path = require('path')
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys')
const pino = require('pino')
const { Boom } = require('@hapi/boom')
const readline = require('readline')
const { smsg, makeWASocket: makeWASocketSimple, bind } = require('./lib/msg.js')

let handleMessage = require('./Levvi.js')

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

const question = (text) => new Promise((resolve) => rl.question(text, resolve))

let reconnectTimeout = null
let isReconnecting = false

function reload(file) {
    const filePath = path.resolve(file)

    fs.watchFile(filePath, () => {
        fs.unwatchFile(filePath)
        console.log(`Reloaded: ${file}`)

        delete require.cache[require.resolve(file)]

        try {
            if (file.includes('Levvi.js')) {
                handleMessage = require('./Levvi.js')
            } else if (file.includes('msg.js')) {
                delete require.cache[require.resolve('./lib/msg.js')]
                const msg = require('./lib/msg.js')
                global.smsg = msg.smsg
                global.bind = msg.bind
            }

            reload(file)
        } catch (err) {
            console.log(`❌ Error reload ${file}:`, err)
        }
    })
}

reload('./Levvi.js')
reload('./lib/msg.js')

async function connectToWhatsApp() {
    if (isReconnecting) return
    isReconnecting = true

    const { state, saveCreds } = await useMultiFileAuthState('auth')

    const conn = makeWASocketSimple({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Safari'),
        auth: state
    })

    bind(conn)

    if (!conn.authState.creds.registered) {
        console.log('Masukkan nomor telepon (cth: 628xxxxxx):')
        const phoneNumber = await question('NUMBER: ')
        const code = await conn.requestPairingCode(phoneNumber, 'L3VIC0DE')
        console.log(`KODE PAIRING: ${code}`)
    }

    conn.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            let m = chatUpdate.messages[0]
            if (!m.message) return
            if (m.key?.remoteJid === 'status@broadcast') return
            if (m.key.fromMe) return

            let processedMsg
            try {
                processedMsg = await smsg(conn, m)
            } catch (err) {
                console.error('❌ smsg error:', err.message)
                return
            }

            if (!processedMsg) return

            await handleMessage(conn, processedMsg)
        } catch (err) {
            console.error('❌ messages.upsert error:', err)
        }
    })

    conn.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update

        if (connection === 'close') {
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut

            console.log('Connection closed, reconnecting:', shouldReconnect)

            if (shouldReconnect) {
                if (reconnectTimeout) clearTimeout(reconnectTimeout)

                reconnectTimeout = setTimeout(() => {
                    isReconnecting = false
                    connectToWhatsApp()
                }, 5000)
            } else {
                console.log('🔒 Logged out, tidak akan reconnect')
                isReconnecting = false
            }
        } else if (connection === 'open') {
            console.log('✅ Connected to WhatsApp')
            isReconnecting = false

            if (reconnectTimeout) clearTimeout(reconnectTimeout)
        }
    })

    conn.ev.on('creds.update', saveCreds)
}

connectToWhatsApp()