const { downloadMediaMessage, delay } = require("baileys");
const fs = require("fs");
const mime = require("mime-types");
const randomstring = require("randomstring");
const { query } = require("../database/dbpromise");
const path = require("path");
const { getIOInstance } = require("../socket");
const { getSession } = require("../middlewares/req");
const { fetchProfileUrl, fetchGroupMeta } = require("./control");
const {
  decodeObject,
  updateMessageObjectInFile,
  addObjectToFile,
  encodeChatId,
  removeNumberAfterColon,
  saveImageToFile,
} = require("./function");
const fetch = require("node-fetch");

async function safeFetch(url, bodyObj) {
  try {
    await fetch(url, {
      method: "POST",
      body: JSON.stringify(bodyObj),
      headers: { "Content-Type": "application/json" },
      timeout: 15 * 60 * 1000, // 15 minutes in milliseconds
    });
  } catch (error) {
    // Ignore errors (no handling needed)
  }
}

function downloadMediaPromise(m, mimetype) {
  return new Promise(async (resolve) => {
    try {
      const bufferMsg = await downloadMediaMessage(m, "buffer", {}, {});
      console.log({ m: JSON.stringify(m) });
      const randomSt = randomstring.generate(6);
      const mimeType = mime.extension(mimetype);
      const fileName = `${randomSt}_inbox.${mimeType}`;
      const filePath = `${__dirname}/../client/public/media/${fileName}`;

      saveImageToFile(bufferMsg, filePath, mimetype);

      resolve({ success: true, fileName });
    } catch (err) {
      console.log(err);
      resolve({ err, success: false });
    }
  });
}

async function convertMsg({ obj = {}, outgoing = false }) {
  // console.log({ obj: JSON.stringify(obj) })
  const timestamp = Math.floor(Date.now() / 1000);

  // for image message
  if (
    obj?.message?.imageMessage &&
    obj?.key?.remoteJid !== "status@broadcast" &&
    obj?.key?.remoteJid
  ) {
    const downloadMedia = await downloadMediaPromise(
      obj,
      obj?.message?.imageMessage?.mimetype
    );
    console.log({
      downloadMedia,
    });
    let context;

    if (obj?.message?.imageMessage?.contextInfo) {
      context = {
        jid: obj?.message?.imageMessage?.contextInfo?.participant,
        id: obj?.message?.imageMessage?.contextInfo?.stanzaId,
      };
    } else {
      context = "";
    }

    if (obj?.key?.remoteJid?.endsWith("@g.us")) {
      return {
        group: true,
        type: "image",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          caption: obj?.message?.imageMessage?.caption || "",
          fileName: downloadMedia?.success ? downloadMedia.fileName : "",
          mimetype: obj?.message?.imageMessage?.mimetype,
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: context,
      };
    }
    if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
      return {
        group: false,
        type: "image",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          caption: obj?.message?.imageMessage?.caption || "",
          fileName: downloadMedia?.success ? downloadMedia.fileName : "",
          mimetype: obj?.message?.imageMessage?.mimetype,
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: context,
      };
    }
  }
  // for location message
  else if (
    obj?.message?.locationMessage &&
    obj?.key?.remoteJid !== "status@broadcast" &&
    obj?.key?.remoteJid
  ) {
    if (obj?.key?.remoteJid?.endsWith("@g.us")) {
      return {
        group: true,
        type: "loc",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          lat: obj?.message?.locationMessage?.degreesLatitude,
          long: obj?.message?.locationMessage?.degreesLongitude,
          name: obj?.message?.locationMessage?.name,
          address: obj?.message?.locationMessage?.address,
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: "",
      };
    }
    if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
      return {
        group: false,
        type: "loc",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          lat: obj?.message?.locationMessage?.degreesLatitude,
          long: obj?.message?.locationMessage?.degreesLongitude,
          name: obj?.message?.locationMessage?.name,
          address: obj?.message?.locationMessage?.address,
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: "",
      };
    }
  }
  // for text message
  else if (
    obj?.message?.conversation &&
    obj?.key?.remoteJid !== "status@broadcast" &&
    obj?.key?.remoteJid
  ) {
    if (obj?.key?.remoteJid?.endsWith("@g.us")) {
      return {
        group: true,
        type: "text",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          text: obj?.message?.conversation,
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: "",
      };
    }
    if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
      return {
        group: false,
        type: "text",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          text: obj?.message?.conversation,
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: "",
      };
    }
  }
  // for text for ectended
  else if (
    !obj?.message?.extendedTextMessage?.contextInfo?.stanzaId &&
    obj?.message?.extendedTextMessage?.text &&
    obj?.key?.remoteJid !== "status@broadcast" &&
    obj?.key?.remoteJid
  ) {
    if (obj?.key?.remoteJid?.endsWith("@g.us")) {
      return {
        group: true,
        type: "text",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          text: obj?.message?.extendedTextMessage?.text,
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: "",
      };
    }
    if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
      return {
        group: false,
        type: "text",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          text: obj?.message?.extendedTextMessage?.text,
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: "",
      };
    }
  }
  // for video mesage
  else if (
    obj?.message?.videoMessage &&
    obj?.key?.remoteJid !== "status@broadcast" &&
    obj?.key?.remoteJid
  ) {
    const downloadMedia = await downloadMediaPromise(
      obj,
      obj?.message?.videoMessage?.mimetype
    );

    let context;

    if (obj?.message?.videoMessage?.contextInfo) {
      context = {
        jid: obj?.message?.videoMessage?.contextInfo?.participant,
        id: obj?.message?.videoMessage?.contextInfo?.stanzaId,
      };
    } else {
      context = "";
    }

    if (obj?.key?.remoteJid?.endsWith("@g.us")) {
      return {
        group: true,
        type: "video",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          caption: obj?.message?.videoMessage?.caption,
          fileName: downloadMedia?.success ? downloadMedia.fileName : "",
          mimetype: obj?.message?.videoMessage?.mimetype,
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: context,
      };
    }
    if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
      return {
        group: false,
        type: "video",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          caption: obj?.message?.videoMessage?.caption,
          fileName: downloadMedia?.success ? downloadMedia.fileName : "",
          mimetype: obj?.message?.videoMessage?.mimetype,
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: context,
      };
    }
  }
  // document message
  else if (
    obj?.message?.documentMessage &&
    obj?.key?.remoteJid !== "status@broadcast" &&
    obj?.key?.remoteJid
  ) {
    const downloadMedia = await downloadMediaPromise(
      obj,
      obj?.message?.documentMessage?.mimetype?.replace(
        "application/x-javascript",
        "application/javascript"
      )
    );
    let context;

    if (obj?.message?.documentMessage?.contextInfo) {
      context = {
        jid: obj?.message?.documentMessage?.contextInfo?.participant,
        id: obj?.message?.documentMessage?.contextInfo?.stanzaId,
      };
    } else {
      context = "";
    }

    if (obj?.key?.remoteJid?.endsWith("@g.us")) {
      return {
        group: true,
        type: "doc",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          caption: "",
          fileName: downloadMedia?.success ? downloadMedia.fileName : "",
          mimetype: obj?.message?.documentMessage?.mimetype,
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: context,
      };
    }
    if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
      return {
        group: false,
        type: "doc",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          caption: "",
          fileName: downloadMedia?.success ? downloadMedia.fileName : "",
          mimetype: obj?.message?.documentMessage?.mimetype,
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: context,
      };
    }
  }
  // audio message
  else if (
    obj?.message?.audioMessage &&
    obj?.key?.remoteJid !== "status@broadcast" &&
    obj?.key?.remoteJid
  ) {
    const downloadMedia = await downloadMediaPromise(
      obj,
      obj?.message?.audioMessage?.mimetype
    );

    let context;

    if (obj?.message?.audioMessage?.contextInfo) {
      context = {
        jid: obj?.message?.audioMessage?.contextInfo?.participant,
        id: obj?.message?.audioMessage?.contextInfo?.stanzaId,
      };
    } else {
      context = "";
    }

    if (obj?.key?.remoteJid?.endsWith("@g.us")) {
      return {
        group: true,
        type: "aud",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          caption: "",
          fileName: downloadMedia?.success ? downloadMedia.fileName : "",
          mimetype: obj?.message?.audioMessage?.mimetype,
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: context,
      };
    }
    if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
      return {
        group: false,
        type: "aud",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          caption: "",
          fileName: downloadMedia?.success ? downloadMedia.fileName : "",
          mimetype: obj?.message?.audioMessage?.mimetype,
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: context,
      };
    }
  }
  // document with caption
  else if (
    obj?.message?.documentWithCaptionMessage &&
    obj?.key?.remoteJid !== "status@broadcast" &&
    obj?.key?.remoteJid
  ) {
    const downloadMedia = await downloadMediaPromise(
      obj,
      obj?.message?.documentWithCaptionMessage?.message?.documentMessage?.mimetype?.replace(
        "application/x-javascript",
        "application/javascript"
      )
    );

    let context;

    if (obj?.message?.documentWithCaptionMessage?.contextInfo) {
      context = {
        jid: obj?.message?.documentWithCaptionMessage?.contextInfo?.participant,
        id: obj?.message?.documentWithCaptionMessage?.contextInfo?.stanzaId,
      };
    } else {
      context = "";
    }

    if (obj?.key?.remoteJid?.endsWith("@g.us")) {
      return {
        group: true,
        type: "doc_cap",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          caption:
            obj?.message?.documentWithCaptionMessage?.message?.documentMessage
              ?.caption,
          fileName: downloadMedia?.success ? downloadMedia.fileName : "",
          mimetype:
            obj?.message?.documentWithCaptionMessage?.message?.documentMessage?.mimetype?.replace(
              "application/x-javascript",
              "application/javascript"
            ),
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: context,
      };
    }
    if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
      return {
        group: false,
        type: "doc_cap",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          caption:
            obj?.message?.documentWithCaptionMessage?.message?.documentMessage
              ?.caption,
          fileName: downloadMedia?.success ? downloadMedia.fileName : "",
          mimetype:
            obj?.message?.documentWithCaptionMessage?.message?.documentMessage?.mimetype?.replace(
              "application/x-javascript",
              "application/javascript"
            ),
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: context,
      };
    }
  }
  // updating delivery
  else if (
    obj?.message?.update &&
    obj?.key?.remoteJid !== "status@broadcast" &&
    obj?.key?.remoteJid &&
    obj?.update?.status
  ) {
    if (obj?.key?.remoteJid?.endsWith("@g.us")) {
      return {
        group: true,
        type: "update",
        updateType: obj?.update?.status === 4 ? "read" : "delivery",
        msgId: obj?.key?.id,
      };
    }
    if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
      return {
        group: false,
        type: "update",
        updateType: obj?.update?.status === 4 ? "read" : "delivery",
        msgId: obj?.key?.id,
      };
    }
  }
  // adding reaction
  else if (obj?.message?.reactionMessage) {
    if (obj?.key?.remoteJid?.endsWith("@g.us")) {
      return {
        group: true,
        type: "reaction",
        msgId: obj?.message?.reactionMessage?.key?.id,
        reaction: obj?.message?.reactionMessage?.text,
      };
    }
    if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
      return {
        group: false,
        type: "reaction",
        msgId: obj?.message?.reactionMessage?.key?.id,
        reaction: obj?.message?.reactionMessage?.text,
      };
    }
  }
  // adding quotes text extended message
  else if (
    obj?.message?.extendedTextMessage?.contextInfo?.stanzaId &&
    obj?.key?.remoteJid !== "status@broadcast"
  ) {
    if (obj?.key?.remoteJid?.endsWith("@g.us")) {
      return {
        group: true,
        type: "text",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          text: obj?.message?.extendedTextMessage?.text,
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: {
          jid: obj?.message?.extendedTextMessage?.contextInfo?.participant,
          id: obj?.message?.extendedTextMessage?.contextInfo?.stanzaId,
        },
      };
    }
    if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
      return {
        group: false,
        type: "text",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          text: obj?.message?.extendedTextMessage?.text,
        },
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
        context: {
          jid: obj?.message?.extendedTextMessage?.contextInfo?.participant,
          id: obj?.message?.extendedTextMessage?.contextInfo?.stanzaId,
        },
      };
    }
  } else {
    return null;
  }
}

async function extractData(m, sessionId) {
  const { uid } = decodeObject(sessionId);

  const chatId = uid
    ? encodeChatId({
        ins: sessionId,
        grp: m?.key?.remoteJid?.endsWith("@g.us") ? true : false,
        num: m?.key?.remoteJid?.endsWith("@g.us")
          ? m?.key?.remoteJid?.replace("@g.us", "")
          : m?.key?.remoteJid?.replace("@s.whatsapp.net", ""),
      })
    : { na: "na" };

  const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);

  const actualObj = await convertMsg({
    obj: m,
    outgoing: m?.key?.fromMe ? true : false,
  });

  return {
    uid: uid,
    sessionId,
    chatId,
    actualObj,
    userData: getUser[0],
    msgFromMe: m?.key?.fromMe,
    remoteJid: m?.key?.remoteJid,
  };
}

async function updateReaction({ uid, chatId, reaction, msgId, actualObj }) {
  const io = getIOInstance();
  const getId = await query(`SELECT * FROM rooms WHERE uid = ?`, [uid]);
  const socketId = getId[0]?.socket_id;

  const filePath = `${__dirname}/../conversations/inbox/${uid}/${chatId}.json`;

  io.to(socketId).emit("push_new_reaction", {
    reaction: reaction,
    chatId: chatId,
    msgId: msgId,
  });

  setTimeout(() => {
    updateMessageObjectInFile(
      filePath,
      actualObj?.msgId,
      "reaction",
      actualObj?.reaction
    );
  }, 1000);
}

async function updatingInMysql({
  session,
  remoteJid,
  isGroup,
  chatId,
  actualObj,
  uid,
  sessionId,
  chat,
  fromMe,
}) {
  try {
    // if chat is new
    if (!fromMe && chat.length < 1) {
      let profile_image = "";
      const image = await fetchProfileUrl(session, remoteJid);

      if (image) {
        profile_image = image;
      }

      let groupData = "";
      let notRestrict = 1;

      if (isGroup) {
        groupData = await fetchGroupMeta(session, remoteJid);
        if (groupData) {
          groupData = groupData;
        }

        if (groupData?.restrict) {
          notRestrict = 0;
        }
      }

      await query(
        `INSERT INTO chats (
                    chat_id, 
                    uid,
                    last_message_came,
                    sender_name,
                    sender_mobile,
                    sender_jid,
                    last_message,
                    instance_id,
                    profile_image,
                    group_data,
                    can_reply
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          chatId,
          uid,
          actualObj?.timestamp,
          actualObj?.group ? groupData?.subject : actualObj?.senderName,
          remoteJid?.endsWith("@g.us")
            ? remoteJid?.replace("@g.us", "")
            : remoteJid?.replace("@s.whatsapp.net", ""),
          remoteJid,
          JSON.stringify(actualObj),
          sessionId,
          profile_image,
          groupData ? JSON.stringify(groupData) : "",
          notRestrict > 0 ? 1 : 0,
        ]
      );
    } else {
      console.log({ sessionId });
      // if chat is old
      await query(
        `UPDATE chats SET last_message_came = ?, last_message = ?, is_opened = ? WHERE chat_id = ? AND uid = ? AND instance_id = ? `,
        [
          actualObj?.timestamp?.low || actualObj?.timestamp,
          JSON.stringify(actualObj),
          0,
          chatId,
          uid,
          sessionId,
        ]
      );
    }
  } catch (err) {
    console.log(`Error in updatingInMysql`, err);
  }
}

async function sendNewMsgSocket({ uid, sessionId, chatId, actualObj }) {
  const io = getIOInstance();

  const getId = await query(`SELECT * FROM rooms WHERE uid = ?`, [uid]);

  const chats = await query(
    `SELECT * FROM chats WHERE uid = ? AND instance_id = ?`,
    [uid, sessionId]
  );

  io.to(getId[0]?.socket_id).emit("update_conversations", { chats: chats });

  io.to(getId[0]?.socket_id).emit("push_new_msg", {
    msg: actualObj,
    chatId: chatId,
    sessionId: sessionId,
  });
}

// hitting webhoks url
async function hitWebhook({ sessionId, state }) {
  try {
    // get session
    const [instance] = await query(
      `SELECT * FROM instance WHERE instance_id = ?`,
      [sessionId]
    );
    if (instance?.id) {
      safeFetch(instance.webhook, state);
    }
  } catch (error) {
    console.log(error);
  }
}

async function webhookIncoming(m, sessionId, session) {
  // extracting the functions
  const state = await extractData(m, sessionId);

  hitWebhook({ sessionId, state });

  if (state.uid) {
    // returning if msg is unknown
    if (!state.actualObj) {
      return;
    }

    // updating reaction
    if (state.actualObj?.type === "reaction") {
      await updateReaction({
        uid: state.uid,
        chatId: state.chatId,
        reaction: state.actualObj?.reaction,
        msgId: state.actualObj?.msgId,
        actualObj: state.actualObj,
      });
      return;
    }

    // getting chat from mysql
    const chat = await query(
      `SELECT * FROM chats WHERE chat_id = ? AND uid = ?`,
      [state.chatId, state.uid, state.sessionId]
    );

    // updating chat in databse mysql
    await updatingInMysql({
      session: session,
      remoteJid: state.remoteJid,
      isGroup: state.actualObj.group,
      chatId: state.chatId,
      actualObj: state.actualObj,
      uid: state.uid,
      sessionId: state.sessionId,
      chat: chat,
      fromMe: state.msgFromMe,
    });

    // saving conversation locally
    const chatPath = `${__dirname}/../conversations/inbox/${state.uid}/${state.chatId}.json`;

    addObjectToFile(state.actualObj, chatPath);

    if (
      state.userData?.opened_chat_instance &&
      state.userData?.opened_chat_instance === state.sessionId
    ) {
      await sendNewMsgSocket({
        uid: state.uid,
        sessionId: state.sessionId,
        actualObj: state.actualObj,
        chatId: state.chatId,
      });
    }
  }
}

async function returnStateDelivery(obj, uid, sessionId) {
  const chatId = encodeChatId({
    ins: sessionId,
    grp: obj?.key?.remoteJid?.endsWith("@g.us") ? true : false,
    num: obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")
      ? removeNumberAfterColon(obj?.key?.remoteJid)?.replace(
          "@s.whatsapp.net",
          ""
        )
      : removeNumberAfterColon(obj?.key?.remoteJid)?.replace("@g.us", ""),
  });

  const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);

  return {
    chatId: chatId,
    userData: getUser[0],
  };
}

async function updateDeliverySocket({ uid, chatId, obj }) {
  const io = getIOInstance();
  const getId = await query(`SELECT * FROM rooms WHERE uid = ?`, [uid]);
  const socketId = getId[0]?.socket_id;

  io.to(socketId).emit("update_delivery_status", {
    chatId: chatId,
    status: obj?.update?.status === 4 ? "read" : "delivered",
    msgId: obj?.key?.id,
  });
}

function extractVoters(options) {
  // Check if options is a valid array
  if (!Array.isArray(options)) {
    return [];
  }

  let result = [];

  for (let option of options) {
    // Check if each option is a valid object with the required properties
    if (
      typeof option !== "object" ||
      !option.hasOwnProperty("name") ||
      !Array.isArray(option.voters)
    ) {
      return [];
    }

    option.voters.forEach((voter) => {
      if (typeof voter === "string") {
        result.push({ name: option.name, voter: voter });
      }
    });
  }

  return result;
}

async function updatePool(vote, uid, msg_id, jid) {
  const voter = extractVoters(vote);

  if (voter.length < 1) {
    await query(
      `DELETE FROM poll_votes WHERE uid = ? AND msg_id = ? AND voter = ?`,
      [uid, msg_id, jid]
    );
  } else {
    const voterJid = voter[0]?.voter;
    const option = voter[0]?.name;

    if (voterJid && option) {
      await query(
        `INSERT INTO poll_votes (uid, msg_id, vote_option, voter) VALUES (?,?,?,?)`,
        [uid, msg_id, option, voterJid]
      );
    }
  }
}

async function updateDelivery(obj, sessionId, pollMessage) {
  await delay(2000);
  if (pollMessage && pollMessage?.length > 0) {
    const { uid } = decodeObject(sessionId);
    await updatePool(
      pollMessage,
      uid,
      obj?.key?.id,
      obj?.update?.pollUpdates[0]?.pollUpdateMessageKey?.participant
    );
  }

  if (obj?.key?.fromMe) {
    const { uid } = decodeObject(sessionId);
    const state = await returnStateDelivery(obj, uid, sessionId);

    if (state.userData?.opened_chat_instance === sessionId) {
      await updateDeliverySocket({
        uid: uid,
        chatId: state.chatId,
        obj: obj,
        sessionId: sessionId,
      });
    }

    const delivery_time = Date.now() / 1000;
    await query(
      `UPDATE broadcast_log SET delivery_status = ?, delivery_time = ? WHERE msg_id = ?`,
      [
        obj?.update?.status === 4 ? "read" : "delivered",
        delivery_time,
        obj?.key?.id,
      ]
    );

    // adding delivery update locally
    const filePath = `${__dirname}/../conversations/inbox/${uid}/${state.chatId}.json`;

    setTimeout(() => {
      updateMessageObjectInFile(
        filePath,
        obj?.key?.id,
        "status",
        obj?.update?.status === 4 ? "read" : "delivered"
      );
    }, 1000);
  }
}

// --------------------------

function sendPollMsg({
  uid,
  msgObj,
  toJid,
  saveObj,
  chatId,
  session,
  sessionId,
  sendObj,
}) {
  return new Promise(async (resolve) => {
    try {
      if (!session) {
        return res.json({
          success: false,
          msg: "Instance not found. Please try again",
        });
      }

      const msg = await session.sendMessage(toJid, sendObj);

      if (msg?.key?.id) {
        const finalSaveMsg = {
          ...saveObj,
          msgId: msg?.key?.id,
          timestamp: msg?.messageTimestamp?.low,
        };

        const chatPath = `${__dirname}/../conversations/inbox/${uid}/${chatId}.json`;

        addObjectToFile(finalSaveMsg, chatPath);

        await query(
          `UPDATE chats SET last_message_came = ?, last_message = ?, is_opened = ? WHERE chat_id = ? AND instance_id = ?`,
          [
            msg?.messageTimestamp?.low,
            JSON.stringify(finalSaveMsg),
            1,
            chatId,
            sessionId,
          ]
        );

        // updating socket
        const [user] = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);

        if (user?.opened_chat_instance === sessionId) {
          const io = getIOInstance();

          const getId = await query(`SELECT * FROM rooms WHERE uid = ?`, [uid]);

          await query(`UPDATE chats SET is_opened = ? WHERE chat_id = ?`, [
            1,
            chatId,
          ]);

          const chats = await query(
            `SELECT * FROM chats WHERE uid = ? AND instance_id = ?`,
            [uid, sessionId]
          );

          io.to(getId[0]?.socket_id).emit("update_conversations", {
            chats: chats,
            notificationOff: true,
          });

          io.to(getId[0]?.socket_id).emit("push_new_msg", {
            msg: finalSaveMsg,
            chatId: chatId,
            sessionId: sessionId,
          });
        }

        resolve({ success: true });
      } else {
        console.log(`error found in sendPollMsg`, msg);
        resolve({
          msg: "Unknown error found could not send messsage. Please try to re add instance",
          err: msg?.toString(),
        });
      }
    } catch (err) {
      resolve({ success: false, msg: err.toString(), err });
      console.log(err);
    }
  });
}

function sendTextMsg({
  uid,
  msgObj,
  toJid,
  saveObj,
  chatId,
  session,
  sessionId,
}) {
  return new Promise(async (resolve) => {
    try {
      if (!session) {
        return res.json({
          success: false,
          msg: "Instance not found. Please try again",
        });
      }
      const msg = await session.sendMessage(toJid, msgObj);

      if (msg?.key?.id) {
        const finalSaveMsg = {
          ...saveObj,
          msgId: msg?.key?.id,
          timestamp: msg?.messageTimestamp?.low,
        };

        const chatPath = `${__dirname}/../conversations/inbox/${uid}/${chatId}.json`;

        addObjectToFile(finalSaveMsg, chatPath);

        await query(
          `UPDATE chats SET last_message_came = ?, last_message = ?, is_opened = ? WHERE chat_id = ? AND instance_id = ?`,
          [
            msg?.messageTimestamp?.low,
            JSON.stringify(finalSaveMsg),
            1,
            chatId,
            sessionId,
          ]
        );

        // updating socket
        const [user] = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);

        if (user?.opened_chat_instance === sessionId) {
          const io = getIOInstance();

          const getId = await query(`SELECT * FROM rooms WHERE uid = ?`, [uid]);

          await query(`UPDATE chats SET is_opened = ? WHERE chat_id = ?`, [
            1,
            chatId,
          ]);

          const chats = await query(
            `SELECT * FROM chats WHERE uid = ? AND instance_id = ?`,
            [uid, sessionId]
          );

          io.to(getId[0]?.socket_id).emit("update_conversations", {
            chats: chats,
            notificationOff: true,
          });

          io.to(getId[0]?.socket_id).emit("push_new_msg", {
            msg: finalSaveMsg,
            chatId: chatId,
            sessionId: sessionId,
          });
        }

        resolve({ success: true });
      } else {
        console.log(`error found in sendChatTextMessage`, msg);
        resolve({
          msg: "Unknown error found could not send messsage. Please try to re add instance",
          err: msg?.toString(),
        });
      }
    } catch (err) {
      resolve({ success: false, msg: err.toString(), err });
      console.log(err);
    }
  });
}

function sendMedia({
  uid,
  msgObj,
  toJid,
  saveObj,
  chatId,
  session,
  sessionId,
  sendObj,
}) {
  return new Promise(async (resolve) => {
    try {
      if (!session) {
        return res.json({
          success: false,
          msg: "Instance not found. Please try again",
        });
      }

      const msg = await session.sendMessage(toJid, sendObj);

      if (msg?.key?.id) {
        const finalSaveMsg = {
          ...saveObj,
          msgId: msg?.key?.id,
          timestamp: msg?.messageTimestamp?.low,
        };

        const chatPath = `${__dirname}/../conversations/inbox/${uid}/${chatId}.json`;

        addObjectToFile(finalSaveMsg, chatPath);

        await query(
          `UPDATE chats SET last_message_came = ?, last_message = ?, is_opened = ? WHERE chat_id = ? AND instance_id = ?`,
          [
            msg?.messageTimestamp?.low,
            JSON.stringify(finalSaveMsg),
            1,
            chatId,
            sessionId,
          ]
        );

        // updating socket
        const [user] = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);

        if (user?.opened_chat_instance === sessionId) {
          const io = getIOInstance();

          const getId = await query(`SELECT * FROM rooms WHERE uid = ?`, [uid]);

          await query(`UPDATE chats SET is_opened = ? WHERE chat_id = ?`, [
            1,
            chatId,
          ]);

          const chats = await query(
            `SELECT * FROM chats WHERE uid = ? AND instance_id = ?`,
            [uid, sessionId]
          );

          io.to(getId[0]?.socket_id).emit("update_conversations", {
            chats: chats,
            notificationOff: true,
          });

          io.to(getId[0]?.socket_id).emit("push_new_msg", {
            msg: finalSaveMsg,
            chatId: chatId,
            sessionId: sessionId,
          });
        }

        resolve({ success: true });
      } else {
        console.log(`error found in sendChatTextMessage`, msg);
        resolve({
          msg: "Unknown error found could not send messsage. Please try to re add instance",
          err: msg?.toString(),
        });
      }
    } catch (err) {
      resolve({ success: false, msg: err.toString(), err });
      console.log(err);
    }
  });
}

module.exports = {
  webhookIncoming,
  updateDelivery,
  sendTextMsg,
  sendMedia,
  sendPollMsg,
};
