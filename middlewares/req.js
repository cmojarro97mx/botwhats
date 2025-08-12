const { existsSync, unlinkSync, readdir } = require("fs");
const { join } = require("path");
const pino = require("pino");
const makeWASocket = require("baileys").default;
const {
  Browsers,
  DisconnectReason,
  delay,
  useMultiFileAuthState,
  getAggregateVotesInPollMessage,
  downloadMediaMessage,
  getUrlInfo,
} = require("baileys");
const { toDataURL } = require("qrcode");
const dirName = require("../dirname.js");
const response = require("../response.js");
const {
  decodeObject,
  deleteFileIfExists,
} = require("../functions/function.js");
const fs = require("fs");
const path = require("path");
const { query } = require("../database/dbpromise.js");
const { webhookIncoming, updateDelivery } = require("../functions/x.js");
const { chatbotInit } = require("../loops/chatBot.js");
const { makeInMemoryStore } = require("@rodrigogs/baileys-store");

const sessions = new Map();
const retries = new Map();

const sessionsDir = (sessionId = "") => {
  return join(dirName, "sessions", sessionId ? `${sessionId}.json` : "");
};

const isSessionExists = (sessionId) => {
  return sessions.has(sessionId);
};

const isSessionFileExists = (name) => {
  return existsSync(sessionsDir(name));
};

const shouldReconnect = (sessionId) => {
  let maxRetries = parseInt(5);
  let attempts = retries.get(sessionId) ?? 0;

  maxRetries = maxRetries < 1 ? 1 : maxRetries;

  if (attempts < maxRetries) {
    ++attempts;

    console.log("Reconnecting...", { attempts, sessionId });
    retries.set(sessionId, attempts);

    return true;
  }
  return false;
};

const createSession = async (
  sessionId,
  isLegacy = false,
  req,
  res,
  getPairCode,
  syncMax = false
) => {
  // const sessionFile = (isLegacy ? 'legacy_' : 'md_') + sessionId
  const sessionFile = "md_" + sessionId;

  const logger = pino({ level: "silent" });
  const store = makeInMemoryStore({ logger });

  const { state, saveCreds } = await useMultiFileAuthState(
    sessionsDir(sessionFile)
  );

  /**
   * @type {import('@whiskeysockets/baileys').CommonSocketConfig}
   */
  const waConfig = {
    auth: state,
    printQRInTerminal: false,
    logger,
    browser: [process.env.APP_NAME || "Chrome", "", ""],
    defaultQueryTimeoutMs: 0,
    markOnlineOnConnect: false,
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 10000,
    generateHighQualityLinkPreview: true,
    patchMessageBeforeSending: (message) => {
      const requiresPatch = !!(
        message.buttonsMessage ||
        message.templateMessage ||
        message.listMessage
      );
      if (requiresPatch) {
        message = {
          viewOnceMessage: {
            message: {
              messageContextInfo: {
                deviceListMetadataVersion: 2,
                deviceListMetadata: {},
              },
              ...message,
            },
          },
        };
      }

      return message;
    },
    syncFullHistory: syncMax || false,
    getMessage,
  };

  async function getMessage(key) {
    if (store) {
      const msg = await store.loadMessage(key?.remoteJid, key?.id);
      return msg?.message || undefined;
    }

    // only if store is present
    return proto.Message.fromObject({});
  }

  /**
   * @type {import('@whiskeysockets/baileys').AnyWASocket}
   */
  const wa = makeWASocket(waConfig);

  if (!isLegacy) {
    store.readFromFile(sessionsDir(`${sessionId}_store`));
    store.bind(wa.ev);
  }

  sessions.set(sessionId, { ...wa, store, isLegacy });

  wa.ev.on("creds.update", saveCreds);

  wa.ev.on("chats.set", ({ chats }) => {
    const datNow = Date.now();
    saveDataToFile(chats, `${datNow}-chats.json`);

    if (isLegacy) {
      store.chats.insertIfAbsent(...chats);
    }
  });

  function saveContacts(contacts) {
    const savedContacts = [];

    contacts.forEach((contact) => {
      const savedContact = {
        id: contact.id,
        name: contact.notify ? contact.notify : "NA",
      };
      savedContacts.push(savedContact);
    });

    return savedContacts;
  }

  function createJsonFile(filename, data) {
    const dirName = path.join(process.cwd(), "contacts");
    const filePath = path.join(dirName, `${filename}.json`);
    const jsonData = JSON.stringify(data, null, 2);

    // Ensure the directory exists, create it if not
    if (!fs.existsSync(dirName)) {
      fs.mkdirSync(dirName, { recursive: true });
    }

    // Check if the file already exists
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, jsonData);
      console.log(`${filename}.json file created successfully.`);
    } else {
      console.log(`${filename}.json file already exists, skipping creation.`);
    }
  }

  if (store) {
    // console.log({ labelOne: JSON.stringify(store.getLabels()) })
  }

  // Function to save data to a local file
  function saveDataToFile(data, filename) {
    // Convert the data to a JSON string
    const jsonData = JSON.stringify(data, null, 2);

    // Write the JSON data to the file
    fs.writeFileSync(filename, jsonData, "utf8", (err) => {
      if (err) {
        console.error(`Error writing to ${filename}: ${err}`);
      } else {
        console.log(`Data saved to ${filename}`);
      }
    });
  }

  wa.ev.on("messaging-history.set", (data) => {
    const contactData = data.contacts;
    const chats = data.chats;

    const filterdGroupChats = chats.filter((item) => {
      item?.id?.endsWith("@g.us");
    });

    const filterdChats = chats.filter((item) => {
      item?.id?.endsWith("@s.whatsapp.net");
    });

    const filteredContacts = contactData.filter((item) =>
      item.id.endsWith("@s.whatsapp.net")
    );

    // const datNow = Date.now()
    // saveDataToFile(data, `${datNow}-yao.json`);

    const { uid } = decodeObject(sessionId);

    if (filteredContacts.length > 0) {
      createJsonFile(`${sessionId}__two`, saveContacts(filteredContacts), uid);
    }
  });

  wa.ev.on("labels.association", (data) => {
    console.log({ labelData: JSON.stringify(data) });
  });

  wa.ev.on("contacts.upsert", (data) => {
    // const datNow = Date.now()
    // saveDataToFile(data, `${datNow}-contact.json`);

    const { uid } = decodeObject(sessionId);
    createJsonFile(`${sessionId}__one`, data, uid);
  });

  wa.ev.on("messages.update", async (m) => {
    const message = m[0];

    if (message?.update?.pollUpdates?.length > 0) {
      const pollCreation = await getMessage(message?.key);
      if (pollCreation) {
        const pollMessage = getAggregateVotesInPollMessage({
          message: pollCreation,
          pollUpdates: message?.update?.pollUpdates,
        });
        updateDelivery(message, sessionId, pollMessage);
        const session = await getSession(sessionId);

        const a = { messages: m };

        // console.log({
        //     messageII: JSON.stringify(message)
        // })

        // if (!message.key.fromMe) {
        //     console.log({
        //         fromMEEE: message.key
        //     })
        chatbotInit(a, wa, sessionId, session, pollMessage);
        // }
      }
    } else {
      if (
        message?.update &&
        message?.key?.remoteJid !== "status@broadcast" &&
        message?.key?.remoteJid &&
        message?.update?.status
      ) {
        // updateMsgDelivery(message, sessionId)
        updateDelivery(message, sessionId);
      }
    }
  });

  function saveFile(filename, data) {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
  }

  // wa.ev.on('groups.upsert', async (m) => {
  //     console.log({ groupUpsert: JSON.stringify(m) })
  // })

  // wa.ev.on('groups.update', async (m) => {
  //     console.log({ groupUpdate: JSON.stringify(m) })
  // })

  // Automatically read incoming messages, uncomment below codes to enable this behaviour
  wa.ev.on("messages.upsert", async (m) => {
    // const dt = Date.now()
    // const fileName = `xxx-update${dt}.json`
    // saveFile(fileName, m)

    const message = m.messages[0];

    // fs.writeFileSync(`${Date.now()}.json`, JSON.stringify(message));

    const session = await getSession(sessionId);

    // console.log({ message: JSON.stringify(message) });

    if (message?.key?.remoteJid !== "status@broadcast" && m.type === "notify") {
      // incomingMsg(message, sessionId, session)
      if (!message.key.fromMe) {
        chatbotInit(m, wa, sessionId, session);
      }

      webhookIncoming(message, sessionId, session);
    }

    // const dt = Date.now()
    // const fileName = `xxx-upsert${dt}.json`
    // saveFile(fileName, msg)

    // console.log({ m: JSON.stringify(m) })

    // if (!message.key.fromMe && m.type === 'notify') {
    //     await delay(1000)
    //     const dt = Date.now()
    //     const fileName = `xxxx${dt}.json`
    //     saveFile(fileName, m)

    //     // await webhook(m, wa, sessionId)
    //     // instanceWebhookFunction(m, wa, sessionId)
    // }
  });

  wa.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    // console.log("message", connection)

    if (connection === "open") {
      retries.delete(sessionId);
    }

    if (connection === "close") {
      if (
        statusCode === DisconnectReason.loggedOut ||
        !shouldReconnect(sessionId)
      ) {
        if (res && !res.headersSent) {
          console.log("Unable to create session.");
          // res.json({ msg: "Unabld to generate QR", success: false, statusCode })
          // res.end()
          response(res, 500, false, "Unable to create session.");
        }

        return deleteSession(sessionId, isLegacy);
      }

      setTimeout(
        () => {
          createSession(sessionId, isLegacy, res, req, getPairCode);
        },
        statusCode === DisconnectReason.restartRequired ? 0 : parseInt(5000)
      );
    }

    if (getPairCode && !wa.authState.creds.registered && update.qr) {
      // console.log("getting pairing code")
      if (res && !res.headersSent) {
        try {
          // console.log(
          //     "Waiting 5s for socket to be ready, otherwise we get 428 Precondition Required error and the socket disconnects..."
          // );
          await delay(5000);
          const phoneNumber = req.body.mobile;
          console.log({ phoneNumber });
          console.log("Requesting pairing code...");
          const code = await wa.requestPairingCode(phoneNumber);
          // console.log(`Pairing code: ${code}`);

          await query(`UPDATE instance SET qr = ? WHERE instance_id = ?`, [
            code,
            sessionId,
          ]);

          res.json({
            msg: "QR code received, please scan the QR code.",
            success: true,
            code,
          });
          res.end();
          // response(res, 200, true, 'QR code received, please scan the QR code.', { code })

          return;
        } catch {
          // res.json({ msg: 'Unable to create pair code.', success: false })
          // res.end()
          response(res, 500, false, "Unable to create pair code.");
        }
      }

      try {
        await wa.logout();
      } catch {
      } finally {
        // deleting instance entry from the phpmyadmin
        deleteSession(sessionId, isLegacy);
      }
    }

    if (update.qr && !getPairCode) {
      // console.log("getting qr code")
      if (res && !res.headersSent) {
        try {
          const qr = await toDataURL(update.qr);

          // console.log({ qr })

          await query(`UPDATE instance SET qr = ? WHERE instance_id = ?`, [
            qr,
            sessionId,
          ]);

          res.json({
            success: true,
            msg: "QR code received, please scan the QR code.",
            qr,
            sessionId,
          });
          res.end();
          // response(res, 200, true, 'QR code received, please scan the QR code.', { qr, sessionId })

          return;
        } catch {
          // res.json({
          //     msg: "Unable to create QR code"
          // })
          // res.end()
          response(res, 500, false, "Unable to create QR code.");
        }
      }

      try {
        await wa.logout();
      } catch {
      } finally {
        // deleting instance entry from the phpmyadmin
        deleteSession(sessionId, isLegacy);
      }
    }
  });
};

/**
 * @returns {(import('@whiskeysockets/baileys').AnyWASocket|null)}
 */
const getSession = (sessionId) => {
  return sessions.get(sessionId) ?? null;
};

const deleteDirectory = (directoryPath) => {
  if (fs.existsSync(directoryPath)) {
    fs.readdirSync(directoryPath).forEach((file) => {
      const filePath = `${directoryPath}/${file}`;
      if (fs.lstatSync(filePath).isDirectory()) {
        deleteDirectory(filePath); // Recursively delete subdirectories
      } else {
        fs.unlinkSync(filePath); // Delete files
      }
    });
    fs.rmdirSync(directoryPath); // Delete the empty directory
  }
};

const deleteSession = async (sessionId, isLegacy = false) => {
  // const sessionFile = (isLegacy ? 'legacy_' : 'md_') + sessionId
  const sessionFile = "md_" + sessionId;
  const storeFile = `${sessionId}_store`;

  // await query(`DELETE FROM instance WHERE instance_id = ?`, [sessionId])

  const dirName = process.cwd();
  deleteFileIfExists(`${dirName}/contacts/${sessionId}.json`);

  if (isSessionFileExists(sessionFile)) {
    deleteDirectory(sessionsDir(sessionFile));
  }

  if (isSessionFileExists(storeFile)) {
    unlinkSync(sessionsDir(storeFile));
  }

  sessions.delete(sessionId);
  retries.delete(sessionId);
};

const getChatList = (sessionId, isGroup = false) => {
  const filter = isGroup ? "@g.us" : "@s.whatsapp.net";
  return getSession(sessionId).store.chats.filter((chat) => {
    return chat.id.endsWith(filter);
  });
};

/**
 * @param {import('@whiskeysockets/baileys').AnyWASocket} session
 */
const isExists = async (session, jid, isGroup = false) => {
  console.log({ jid });
  try {
    let result;

    if (isGroup) {
      console.log("This is not group");
      result = await session.groupMetadata(jid);
      return Boolean(result.id);
    }

    if (session?.isLegacy) {
      result = await session.onWhatsApp(jid);
    } else {
      [result] = await session.onWhatsApp(jid);

      if (typeof result === "undefined") {
        console.log("checked");
        const getNum = jid.replace("@s.whatsapp.net", "");
        [result] = await session.onWhatsApp(`+${getNum}`);
      }
    }

    console.log({ result: result });

    return result?.exists;
  } catch (err) {
    console.log(err);
    return false;
  }
};

function replaceWithRandom(inputText) {
  let updatedText = inputText;

  while (updatedText.includes("[") && updatedText.includes("]")) {
    const start = updatedText.indexOf("[");
    const end = updatedText.indexOf("]");

    if (start !== -1 && end !== -1) {
      const arrayText = updatedText.substring(start + 1, end);
      const items = arrayText.split(",").map((item) => item.trim());

      if (items.length > 0) {
        const randomIndex = Math.floor(Math.random() * items.length);
        const randomItem = items[randomIndex];

        updatedText =
          updatedText.substring(0, start) +
          randomItem +
          updatedText.substring(end + 1);
      }
    }
  }

  return updatedText;
}

/**
 * @param {import('@whiskeysockets/baileys').AnyWASocket} session
 */
const sendMessage = async (session, receiver, message) => {
  try {
    console.log("A");
    if (message?.text) {
      console.log("B");
      const linkPreview = await getUrlInfo(message?.text, {
        thumbnailWidth: 1024,
        fetchOpts: {
          timeout: 5000,
        },
        uploadImage: session.waUploadToServer,
      });

      console.log("C");
      message = {
        text: replaceWithRandom(message?.text),
        linkPreview,
      };
    } else {
      console.log("D");
      message = message;
    }

    console.log("E");
    console.log({ sendingMsg: message });

    if (message?.caption) {
      console.log("F");
      message = { ...message, caption: replaceWithRandom(message?.caption) };
    } else {
      console.log("G");
      message = message;
    }

    console.log("H");
    console.log({ isLegacy: session?.isLegacy || "NA", message: message });
    await delay(1000);
    console.log("I");
    return session.sendMessage(receiver, message);
  } catch (err) {
    console.log(err);
    return Promise.reject(null); // eslint-disable-line prefer-promise-reject-errors
  }
};

const getGroupData = async (session, jid) => {
  try {
    const part = await session.groupMetadata(jid);
    return part;
  } catch {
    return Promise.reject(null); // eslint-disable-line prefer-promise-reject-errors
  }
};

const formatPhone = (phone) => {
  if (phone.endsWith("@s.whatsapp.net")) {
    return phone;
  }

  let formatted = phone.replace(/\D/g, "");

  return (formatted += "@s.whatsapp.net");
};

const formatGroup = (group) => {
  if (group.endsWith("@g.us")) {
    return group;
  }

  let formatted = group.replace(/[^\d-]/g, "");

  return (formatted += "@g.us");
};

const cleanup = () => {
  console.log("Running cleanup before exit.");

  sessions.forEach((session, sessionId) => {
    if (!session.isLegacy) {
      session.store.writeToFile(sessionsDir(`${sessionId}_store`));
    }
  });
};

const init = () => {
  const sessionsDir = path.join(dirName, "sessions");

  fs.readdir(sessionsDir, (err, files) => {
    if (err) {
      throw err;
    }

    for (const file of files) {
      if (
        !file.endsWith(".json") ||
        !file.startsWith("md_") ||
        file.includes("_store")
      ) {
        continue;
      }

      const filename = file.replace(".json", "");
      const isLegacy = filename.split("_", 1)[0] !== "md";
      const sessionId = filename.substring(isLegacy ? 7 : 3);

      createSession(sessionId, isLegacy);
    }
  });
};

module.exports = {
  isSessionExists,
  createSession,
  getSession,
  deleteSession,
  getChatList,
  isExists,
  sendMessage,
  formatPhone,
  formatGroup,
  cleanup,
  init,
  getGroupData,
  getUrlInfo,
  downloadMediaMessage,
};
