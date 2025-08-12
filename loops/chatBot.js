const {
  decodeObject,
  daysDiff,
  readJsonFromFile,
  encodeChatId,
  removeNumberAfterColon,
  getImageAsBase64,
  replaceVariables,
} = require("../functions/function");
const { query } = require("../database/dbpromise");
const { sendMedia, sendTextMsg } = require("../functions/x");
const { delay } = require("baileys");
const { distributeTaskFlow } = require("../functions/chatbot");
const moment = require("moment-timezone");
const { replyByOpenAi } = require("./ai");

function deepReplacePlaceholders(template, replacements) {
  const getValueFromPath = (path, obj) => {
    return path.split(".").reduce((acc, part) => acc && acc[part], obj);
  };

  const replaceString = (str) => {
    return str.replace(/\{([\w.]+)\}/g, (_, path) => {
      const val = getValueFromPath(path, replacements);
      return val !== undefined ? val : `{${path}}`;
    });
  };

  const traverse = (data) => {
    if (Array.isArray(data)) {
      return data.map(traverse);
    } else if (typeof data === "object" && data !== null) {
      const result = {};
      for (const key in data) {
        result[key] = traverse(data[key]);
      }
      return result;
    } else if (typeof data === "string") {
      return replaceString(data);
    } else {
      return data;
    }
  };

  return traverse(template);
}

async function makeRequest({ method, url, body = null, headers = [] }) {
  try {
    // Create an AbortController to handle the timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 seconds

    // Convert headers array to an object
    const headersObject = headers.reduce((acc, { key, value }) => {
      acc[key] = value;
      return acc;
    }, {});

    // Convert body array to an object if it's not GET or DELETE
    const requestBody =
      method === "GET" || method === "DELETE"
        ? undefined
        : JSON.stringify(
            body.reduce((acc, { key, value }) => {
              acc[key] = value;
              return acc;
            }, {})
          );

    // Set up the request configuration
    const config = {
      method,
      headers: headersObject,
      body: requestBody,
      signal: controller.signal,
    };

    console.log({
      config,
    });

    // Perform the request
    const response = await fetch(url, config);

    // Clear the timeout
    clearTimeout(timeoutId);

    // Check if the response status is OK
    if (!response.ok) {
      return { success: false, msg: `HTTP error ${response.status}` };
    }

    // Parse the response
    const data = await response.json();

    // Validate the response
    if (typeof data === "object" || Array.isArray(data)) {
      return { success: true, data };
    } else {
      return { success: false, msg: "Invalid response format" };
    }
  } catch (error) {
    // Handle errors (e.g., timeout, network issues)
    return { success: false, msg: error.message };
  }
}

function getFileNameFromUrl(url) {
  if (typeof url !== "string") return null;

  const urlParts = url.split("/");
  const fileNameWithParams = urlParts.pop() || urlParts.pop(); // Handles trailing slashes
  return fileNameWithParams.split("?")[0].split("#")[0];
}

// Example usage:
const url = "https://example.com/path/to/file.txt?query=123#section";
const fileName = getFileNameFromUrl(url);
console.log(fileName); // Output: file.txt

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

function formatMobileNumber(identifier) {
  if (!identifier) {
    return "";
  }
  return "+" + identifier.replace(/@(s\.whatsapp\.net|g\.us)/, "");
}

async function convertMsg({ obj = {}, outgoing = false, pollMessage = "" }) {
  // console.log({ obj: JSON.stringify(obj) }convertMsg)
  const timestamp = Math.floor(Date.now() / 1000);

  // for image message
  if (
    obj?.message?.imageMessage &&
    obj?.key?.remoteJid !== "status@broadcast" &&
    obj?.key?.remoteJid
  ) {
    if (obj?.key?.remoteJid?.endsWith("@g.us")) {
      return {
        group: true,
        type: "image",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        text: obj?.message?.imageMessage?.caption || "",
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
      };
    }
    if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
      return {
        group: false,
        type: "image",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        text: obj?.message?.imageMessage?.caption || "",
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
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
        text: obj?.message?.locationMessage?.address || "",
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
        text: obj?.message?.locationMessage?.address || "",
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

  // for audio message
  else if (
    obj?.message?.audioMessage &&
    obj?.key?.remoteJid !== "status@broadcast" &&
    obj?.key?.remoteJid
  ) {
    if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
      return {
        group: false,
        type: "audio_transcribe",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {
          text: "",
        },
        text: "audio_transcribe",
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
        text: obj?.message?.conversation || "",
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
        text: obj?.message?.conversation || "",
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
  // for text for extended
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
        text: obj?.message?.extendedTextMessage?.text || "",
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
        text: obj?.message?.extendedTextMessage?.text || "",
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
    if (obj?.key?.remoteJid?.endsWith("@g.us")) {
      return {
        group: true,
        type: "video",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {},
        text: obj?.message?.videoMessage?.caption,
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
      };
    }
    if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
      return {
        group: false,
        type: "video",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {},
        text: obj?.message?.videoMessage?.caption,
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
      };
    }
  }
  // document with caption
  else if (
    obj?.message?.documentWithCaptionMessage &&
    obj?.key?.remoteJid !== "status@broadcast" &&
    obj?.key?.remoteJid
  ) {
    if (obj?.key?.remoteJid?.endsWith("@g.us")) {
      return {
        group: true,
        type: "doc_cap",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {},
        text: obj?.message?.documentWithCaptionMessage?.message?.documentMessage
          ?.caption,
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
      };
    }
    if (obj?.key?.remoteJid?.endsWith("@s.whatsapp.net")) {
      return {
        group: false,
        type: "doc_cap",
        msgId: obj?.key?.id,
        remoteJid: obj?.key?.remoteJid,
        msgContext: {},
        text: obj?.message?.documentWithCaptionMessage?.message?.documentMessage
          ?.caption,
        reaction: "",
        timestamp: obj?.messageTimestamp || timestamp,
        senderName: obj?.pushName,
        status: "sent",
        star: false,
        route: outgoing ? "outgoing" : "incoming",
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
        text: obj?.message?.extendedTextMessage?.text,
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
        text: obj?.message?.extendedTextMessage?.text,
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
  }

  // for poll
  else if (
    pollMessage &&
    obj?.key?.remoteJid !== "status@broadcast" &&
    obj?.key?.remoteJid
  ) {
    const voter = extractVoters(pollMessage);

    if (voter?.length > 0) {
      if (obj?.key?.remoteJid?.endsWith("@g.us")) {
        return {
          group: true,
          type: "poll",
          msgId: obj?.key?.id,
          remoteJid: obj?.key?.remoteJid,
          msgContext: {
            text: voter[0]?.name,
          },
          text: voter[0]?.name || "",
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
          type: "poll",
          msgId: obj?.key?.id,
          remoteJid: obj?.key?.remoteJid,
          msgContext: {
            text: voter[0]?.name,
          },
          text: voter[0]?.name || "",
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
  } else {
    return null;
  }
}

function getRandomBetween(a, b) {
  const num1 = Number(a);
  const num2 = Number(b);

  if (isNaN(num1) || isNaN(num2)) {
    throw new Error("Both inputs must be numbers or numeric strings.");
  }

  if (num1 === num2) return num1;

  const min = Math.min(num1, num2);
  const max = Math.max(num1, num2);

  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function findTargetNodes(nodes, edges, incomingWord) {
  const matchingEdges = edges.filter((edge) => {
    const sourceHandle = edge.sourceHandle?.toLowerCase();
    const lowerIncomingWord = incomingWord?.toLowerCase();

    if (!sourceHandle) return false;

    // Exact match
    if (sourceHandle === lowerIncomingWord) return true;

    // Contains match (if wrapped in brackets like [some text])
    if (sourceHandle.startsWith("[") && sourceHandle.endsWith("]")) {
      const cleanedText = sourceHandle.slice(1, -1).toLowerCase(); // Remove brackets
      return cleanedText.includes(lowerIncomingWord);
    }

    return false;
  });

  const targetNodeIds = matchingEdges.map((edge) => edge.target);
  return nodes.filter((node) => targetNodeIds.includes(node.id));
}

function getReply(nodes, edges, incomingWord) {
  const getNormal = findTargetNodes(nodes, edges, incomingWord);
  if (getNormal.length > 0) {
    return getNormal;
  } else {
    return findTargetNodes(nodes, edges, "{{OTHER_MSG}}");
  }
}

async function checkPlan(uid) {
  console.log(`checkplan uid:`, uid);
  const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);

  console.log({ getUser, uid });

  if (getUser?.length > 0) {
    const user = getUser[0];
    console.log({ userIs: user });

    if (!user?.plan) {
      return false;
    }

    const plan = JSON.parse(user.plan);
    const daysLeft = daysDiff(user.plan_expire);

    if (daysLeft < 1 || parseInt(plan?.chatbot) < 1) {
      return false;
    } else {
      return true;
    }
  } else {
    console.log(`No user found for uid: ${uid}`);
    return false;
  }
}

async function processDelayBetween({ k, msg, nodes, edges }) {
  try {
    let msgObj = {};
    let saveObj = {};
    let sendObj = {};

    console.log("Delay between came");
    const delayNumber = getRandomBetween(
      k?.data?.msgContent?.fromSec,
      k?.data?.msgContent?.toSec
    );
    console.log({ delayNumber });
    await delay(delayNumber * 1000);

    const findSourceFromEdge = edges?.filter((x) => x.source == k?.id);

    if (findSourceFromEdge?.length > 0) {
      const f = findSourceFromEdge[0];
      const msgNew = "";
      const kNew = "";
      const varNew = {};

      const getNodeFromSource = nodes?.filter((x) => x.id == f?.target);

      if (getNodeFromSource?.length > 0) {
        const kNew = getNodeFromSource[0];
        // console.log({ getNodeFromSource: JSON.stringify(getNodeFromSource) });
        const newVars = {};

        const makeObjNew = await makeObjs(
          msg,
          deepReplacePlaceholders(kNew, newVars),
          nodes,
          edges
        );

        console.log({
          before: JSON.stringify(kNew),
          after: JSON.stringify(deepReplacePlaceholders(kNew, newVars)),
          vars: JSON.stringify(newVars),
        });

        return {
          msgObj: makeObjNew?.msgObj,
          saveObj: makeObjNew?.saveObj,
          sendObj: makeObjNew?.sendObj,
        };
      } else {
        return {
          msgObj,
          saveObj,
          sendObj,
        };
      }
    } else {
      console.log("There was no connected node found in the MAKE_REQUEST tool");
      return {
        msgObj,
        saveObj,
        sendObj,
      };
    }
  } catch (err) {
    console.log(err);
    return {
      msgObj: {},
      saveObj: {},
      sendObj: {},
    };
  }
}

async function processMakeRequest({ k, msg, nodes, edges }) {
  try {
    let msgObj = {};
    let saveObj = {};
    let sendObj = {};

    const mobile = formatMobileNumber(msg?.remoteJid) || msg?.remoteJid;
    const name = msg?.senderName;

    const urlAfterAddingVars = replaceVariables(k?.data?.msgContent?.url, {
      name,
      mobile,
    });

    console.log({ urlAfterAddingVars });

    const resp = await makeRequest({
      method: k?.data?.msgContent?.type,
      url: urlAfterAddingVars,
      body: k?.data?.msgContent?.body,
      headers: k?.data?.msgContent?.headers,
    });

    // console.log({
    //   resp,
    // });

    const findSourceFromEdge = edges?.filter((x) => x.source == k?.id);

    if (findSourceFromEdge?.length > 0) {
      const f = findSourceFromEdge[0];
      const msgNew = "";
      const kNew = "";
      const varNew = {};

      const getNodeFromSource = nodes?.filter((x) => x.id == f?.target);

      if (getNodeFromSource?.length > 0) {
        const kNew = getNodeFromSource[0];
        // console.log({ getNodeFromSource: JSON.stringify(getNodeFromSource) });
        const newVars = resp?.success ? resp?.data || {} : {};

        const makeObjNew = await makeObjs(
          msg,
          deepReplacePlaceholders(kNew, newVars),
          nodes,
          edges
        );

        console.log({
          before: JSON.stringify(kNew),
          after: JSON.stringify(deepReplacePlaceholders(kNew, newVars)),
          vars: JSON.stringify(newVars),
        });

        return {
          msgObj: makeObjNew?.msgObj,
          saveObj: makeObjNew?.saveObj,
          sendObj: makeObjNew?.sendObj,
        };
      } else {
        return {
          msgObj,
          saveObj,
          sendObj,
        };
      }
    } else {
      console.log("There was no connected node found in the MAKE_REQUEST tool");
      return {
        msgObj,
        saveObj,
        sendObj,
      };
    }
  } catch (err) {
    console.log(err);
    return {
      msgObj: {},
      saveObj: {},
      sendObj: {},
    };
  }
}

async function makeObjs(msg, k, nodes, edges, newVars = {}) {
  const type = k?.nodeType?.toLowerCase() || k?.type?.toLowerCase();

  console.log({ makeObjs: type });

  if (type === "text") {
    const msgObj = {
      text:
        replaceVariables(k?.data?.msgContent?.text, {
          name: msg?.senderName,
          mobile: formatMobileNumber(msg?.remoteJid) || msg?.remoteJid,
          ...newVars,
        }) || k?.data?.msgContent?.text,
    };

    const saveObj = {
      group: false,
      type: "text",
      msgId: "",
      remoteJid: msg?.remoteJid,
      msgContext: msgObj,
      reaction: "",
      timestamp: "",
      senderName: msg?.senderName,
      status: "sent",
      star: false,
      route: "outgoing",
      context: "",
    };

    const sendObj = {};

    return {
      msgObj,
      saveObj,
      sendObj,
    };
  } else if (type === "image") {
    const sendObj = {
      image: {
        url: `${__dirname}/../client/public/media/${getFileNameFromUrl(
          k?.data?.msgContent?.image?.url
        )}`,
      },

      caption:
        replaceVariables(k?.data?.msgContent?.caption, {
          name: msg?.senderName,
          mobile: formatMobileNumber(msg?.remoteJid) || msg?.remoteJid,
          ...newVars,
        }) ||
        k?.data?.msgContent?.caption ||
        null,

      fileName: getFileNameFromUrl(k?.data?.msgContent?.image?.url),
      jpegThumbnail: getImageAsBase64(
        `${__dirname}/../client/public/media/${getFileNameFromUrl(
          k?.data?.msgContent?.image?.url
        )}`
      ),
    };

    const msgObj = {
      caption:
        replaceVariables(k?.data?.msgContent?.caption, {
          name: msg?.senderName,
          mobile: formatMobileNumber(msg?.remoteJid) || msg?.remoteJid,
          ...newVars,
        }) ||
        k?.data?.msgContent?.caption ||
        "",

      fileName: getFileNameFromUrl(k?.data?.msgContent?.image?.url),
      mimetype: k?.data?.msgContent?.mimetype,
    };

    const saveObj = {
      group: false,
      type: "image",
      msgId: "",
      remoteJid: msg?.remoteJid,
      msgContext: msgObj,
      reaction: "",
      timestamp: "",
      senderName: msg?.senderName,
      status: "sent",
      star: false,
      route: "outgoing",
      context: "",
    };

    return {
      sendObj,
      msgObj,
      saveObj,
    };
  } else if (type === "doc" || type === "document") {
    const sendObj = {
      document: {
        url: `${__dirname}/../client/public/media/${getFileNameFromUrl(
          k?.data?.msgContent?.document?.url
        )}`,
      },

      caption:
        replaceVariables(k?.data?.msgContent?.caption, {
          name: msg?.senderName,
          mobile: formatMobileNumber(msg?.remoteJid) || msg?.remoteJid,
          ...newVars,
        }) ||
        k?.data?.msgContent?.caption ||
        null,

      fileName: getFileNameFromUrl(k?.data?.msgContent?.fileName),
    };

    const msgObj = {
      caption:
        replaceVariables(k?.data?.msgContent?.caption, {
          name: msg?.senderName,
          mobile: formatMobileNumber(msg?.remoteJid) || msg?.remoteJid,
          ...newVars,
        }) ||
        k?.data?.msgContent?.caption ||
        null,

      fileName: getFileNameFromUrl(k?.data?.msgContent?.fileName),
      mimetype: k?.data?.state?.mime || "",
    };

    const saveObj = {
      group: false,
      type: type,
      msgId: "",
      remoteJid: msg?.remoteJid,
      msgContext: msgObj,
      reaction: "",
      timestamp: "",
      senderName: msg?.senderName,
      status: "sent",
      star: false,
      route: "outgoing",
      context: "",
    };

    return {
      sendObj,
      msgObj,
      saveObj,
    };
  } else if (type === "location") {
    const sendObj = {
      location: {
        degreesLatitude: k?.data?.msgContent?.location?.degreesLatitude,
        degreesLongitude: k?.data?.msgContent?.location?.degreesLongitude,
      },
    };

    const msgObj = {
      lat: k?.data?.msgContent?.location?.degreesLatitude,
      long: k?.data?.msgContent?.location?.degreesLongitude,
      name: "",
      address: "",
    };

    const saveObj = {
      group: false,
      type: "loc",
      msgId: "",
      remoteJid: msg?.remoteJid,
      msgContext: msgObj,
      reaction: "",
      timestamp: "",
      senderName: msg?.senderName,
      status: "sent",
      star: false,
      route: "outgoing",
      context: "",
    };

    return {
      sendObj,
      msgObj,
      saveObj,
    };
  } else if (type === "aud" || type === "audio") {
    const sendObj = {
      audio: {
        url: `${__dirname}/../client/public/media/${getFileNameFromUrl(
          k?.data?.msgContent?.audio?.url
        )}`,
      },
      fileName: getFileNameFromUrl(k?.data?.msgContent?.fileName),
      ptt: true,
    };

    const msgObj = {
      caption: "",
      fileName: getFileNameFromUrl(k?.data?.msgContent?.fileName),
      mimetype: k?.data?.msgContent?.data?.state?.mime || "",
    };

    const saveObj = {
      group: false,
      type: "aud",
      msgId: "",
      remoteJid: msg?.remoteJid,
      msgContext: msgObj,
      reaction: "",
      timestamp: "",
      senderName: msg?.senderName,
      status: "sent",
      star: false,
      route: "outgoing",
      context: "",
    };

    return {
      sendObj,
      msgObj,
      saveObj,
    };
  } else if (type === "video") {
    const sendObj = {
      video: {
        url: `${__dirname}/../client/public/media/${getFileNameFromUrl(
          k?.data?.msgContent?.video?.url
        )}`,
      },

      caption:
        replaceVariables(k?.data?.msgContent?.caption, {
          name: msg?.senderName,
          mobile: formatMobileNumber(msg?.remoteJid) || msg?.remoteJid,
          ...newVars,
        }) ||
        k?.data?.msgContent?.caption ||
        null,
    };

    const msgObj = {
      caption:
        replaceVariables(k?.data?.msgContent?.caption, {
          name: msg?.senderName,
          mobile: formatMobileNumber(msg?.remoteJid) || msg?.remoteJid,
          ...newVars,
        }) ||
        k?.data?.msgContent?.caption ||
        "",
      mimetype: k?.data?.state?.mime,
    };

    const saveObj = {
      group: false,
      type: "video",
      msgId: "",
      remoteJid: msg?.remoteJid,
      msgContext: msgObj,
      reaction: "",
      timestamp: "",
      senderName: msg?.senderName,
      status: "sent",
      star: false,
      route: "outgoing",
      context: "",
    };

    return {
      sendObj,
      msgObj,
      saveObj,
    };
  } else if (type === "poll") {
    const msgObj = k?.data?.msgContent;

    const saveObj = {
      group: false,
      type: "poll",
      msgId: "",
      remoteJid: msg?.remoteJid,
      msgContext: msgObj,
      reaction: "",
      timestamp: "",
      senderName: msg?.senderName,
      status: "sent",
      star: false,
      route: "outgoing",
      context: "",
    };

    const sendObj = {};

    return {
      msgObj,
      saveObj,
      sendObj,
    };
  } else if (type === "make_request") {
    const { msgObj, saveObj, sendObj } = await processMakeRequest({
      k,
      msg,
      nodes,
      edges,
    });

    return {
      msgObj,
      saveObj,
      sendObj,
    };
  } else if (type === "delay_between") {
    const { msgObj, saveObj, sendObj } = await processDelayBetween({
      k,
      msg,
      nodes,
      edges,
    });

    return {
      msgObj,
      saveObj,
      sendObj,
    };
  } else {
    return {
      sendObj: {},
      msgObj: {},
      saveObj: {},
    };
  }
}

function isObjectInArray(arr, mobile) {
  const check = arr.filter((x) => x.mobile === mobile);
  return check.length > 0 ? check[0] : false;
}

function hasDatePassedInTimezone(timezone, date) {
  const momentDate = moment.tz(date, timezone);
  const currentMoment = moment.tz(timezone);
  return momentDate.isBefore(currentMoment);
}

async function runChatbot(i, msg, uid, client_id, m, sessionId, session) {
  const chatbot = i;
  const flow = JSON.parse(chatbot?.flow);
  const allowReplyInGroup = parseInt(chatbot?.group_reply) > 0 ? true : false;

  if (msg.group) {
    if (!allowReplyInGroup) {
      return;
    }
  }

  const nodePath = `${__dirname}/../flow-json/nodes/${uid}/${flow?.flow_id}.json`;
  const edgePath = `${__dirname}/../flow-json/edges/${uid}/${flow?.flow_id}.json`;

  const nodes = readJsonFromFile(nodePath);
  const edges = readJsonFromFile(edgePath);

  if (nodes.length > 0 && edges.length > 0) {
    const answer = await getReply(nodes, edges, msg?.text);
    const audioTranscribe = msg?.text === "audio_transcribe" ? true : false;

    console.log({ answer });

    if (answer.length > 0) {
      for (const k of answer) {
        const chatId = encodeChatId({
          ins: sessionId,
          grp: msg?.remoteJid?.endsWith("@g.us") ? true : false,
          num: msg?.remoteJid?.endsWith("@s.whatsapp.net")
            ? removeNumberAfterColon(msg?.remoteJid)?.replace(
                "@s.whatsapp.net",
                ""
              )
            : removeNumberAfterColon(msg?.remoteJid)?.replace("@g.us", ""),
        });

        // console.log({ beforeMakeObj: JSON.stringify({ msg, k }) });

        const { msgObj, saveObj, sendObj } = await makeObjs(
          msg,
          k,
          nodes,
          edges
        );

        console.log({
          afterMakeObj: JSON.stringify({
            msgObj,
            saveObj,
            sendObj,
          }),
        });

        console.dir({ msgObj, saveObj, sendObj }, { depth: null });

        if (chatbot?.instance_id == sessionId) {
          const thisPreventObj = {
            mobile: msg?.remoteJid,
            timestamp: k?.data?.msgContent?.timestamp,
            timezone: k?.data?.msgContent?.timezone,
          };

          console.log({ thisPreventObj });

          // extracting disabled arr
          const disabledArrBefore = chatbot?.prevent_reply
            ? JSON.parse(chatbot?.prevent_reply)
            : [];

          console.log({ disabledArrBefore });

          const checkIfIncluded = isObjectInArray(
            disabledArrBefore,
            msg?.remoteJid
          );

          console.log({
            checkIfIncluded,
            has: hasDatePassedInTimezone(
              checkIfIncluded.timezone,
              checkIfIncluded.timestamp
            ),
          });

          if (
            !hasDatePassedInTimezone(
              checkIfIncluded.timezone,
              checkIfIncluded.timestamp
            ) &&
            checkIfIncluded.timezone &&
            checkIfIncluded.timestamp
          ) {
            return;
          }
          // add your logics here
          if (k?.nodeType === "PREVENT_REPLY" || k?.type === "PREVENT_REPLY") {
            if (!checkIfIncluded) {
              const toBeUpdatedPreventList = [
                ...disabledArrBefore,
                thisPreventObj,
              ];
              await query(`UPDATE chatbot SET prevent_reply = ? WHERE id = ?`, [
                JSON.stringify(toBeUpdatedPreventList),
                chatbot?.id,
              ]);
            }
          }

          const aiAssignedChatNumbers = chatbot?.ai_bot
            ? JSON.parse(chatbot?.ai_bot)
            : [];

          // replying with ai
          if (
            k?.nodeType === "AI" ||
            k?.type === "AI" ||
            aiAssignedChatNumbers?.includes(msg?.remoteJid)
          ) {
            if (k?.data?.msgContent?.assignAi) {
              const pushingNewNum = [...aiAssignedChatNumbers, msg?.remoteJid];
              await query(`UPDATE chatbot SET ai_bot = ? WHERE id = ?`, [
                JSON.stringify(pushingNewNum),
                chatbot?.id,
              ]);
            }

            const replyByAi = await replyByOpenAi({
              uid,
              msgObj,
              toJid: msg?.remoteJid,
              saveObj,
              chatId,
              session,
              sessionId,
              k,
              nodes,
              audioTranscribe,
            });
            if (replyByAi?.success) {
              return;
            }
          }

          if (saveObj?.type === "text" || saveObj?.type === "poll") {
            // returning if this is an audio message
            if (audioTranscribe) return;

            await delay(1000);

            const resp = await sendTextMsg({
              uid,
              msgObj,
              toJid: msg?.remoteJid,
              saveObj,
              chatId,
              session,
              sessionId,
            });
          } else {
            if (saveObj?.type) {
              await delay(1000);

              const resp = await sendMedia({
                uid,
                msgObj,
                toJid: msg?.remoteJid,
                saveObj,
                chatId,
                session,
                sessionId,
                sendObj,
              });
            }
          }
        }
      }
    }
  }
}

async function chatbotInit(m, wa, sessionId, session, pollMessage) {
  try {
    const msg = await convertMsg({
      obj: m?.messages[0],
      pollMessage: pollMessage,
    });

    const incomingText = msg?.text;

    if (incomingText) {
      const { uid, client_id } = decodeObject(sessionId);

      if (await checkPlan(uid)) {
        const chatbots = await query(
          `SELECT * FROM chatbot WHERE uid = ? AND active = ?`,
          [uid, 1]
        );

        if (chatbots.length > 0) {
          await Promise.all(
            chatbots.map((i) =>
              runChatbot(i, msg, uid, client_id, m, sessionId, session)
            )
          );
        }
      } else {
        await query(`UPDATE chatbot SET active = ? WHERE uid = ?`, [0, uid]);
        console.log("Either user has no plan or plan without bot");
      }
    }
  } catch (err) {
    console.log(err);
  }
}

module.exports = { chatbotInit };
