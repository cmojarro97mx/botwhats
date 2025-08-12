const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const { addObjectToFile } = require("../functions/function");
const { query } = require("../database/dbpromise");
const { getIOInstance } = require("../socket");

function readJSONFile(filePath, length) {
  try {
    console.log("HEY");
    // Check if the file exists
    if (!fs.existsSync(filePath)) {
      console.error("File not found:", filePath);
      return []; // Return empty array if file does not exist
    }

    // Read the file content
    let fileContent = fs.readFileSync(filePath, "utf8");

    // }\n]  }\n]

    if (fileContent?.endsWith("}\n]  }\n]")) {
      console.log("FOUND ENDS");
      console.log("Invalid JSON found, making it correct");
      fileContent = fileContent.replace("}\n]  }\n]", "\n}\n]");
      console.log("Correction done!");

      // Write the corrected JSON back to the file
      fs.writeFileSync(filePath, fileContent, "utf8");
      console.log("Corrected JSON has been written to the file");
    }

    // Remove invalid trailing characters if they exist
    if (fileContent?.endsWith("}\n]\n}\n]")) {
      console.log("FOUND ENDS");
      console.log("Invalid JSON found, making it correct");
      fileContent = fileContent.replace("}\n]\n}\n]", "\n}\n]");
      console.log("Correction done!");

      // Write the corrected JSON back to the file
      fs.writeFileSync(filePath, fileContent, "utf8");
      console.log("Corrected JSON has been written to the file");
    }

    // Try to parse the JSON
    let jsonArray;
    try {
      jsonArray = JSON.parse(fileContent);
    } catch (error) {
      console.error("Initial JSON parse error:", error.message);
      return []; // Return empty array if JSON is not valid
    }

    // Check if the parsed content is an array
    if (!Array.isArray(jsonArray)) {
      console.error("Invalid JSON format: not an array");
      return []; // Return empty array if JSON is not an array
    }

    // If length is provided, return only specified number of latest objects
    if (typeof length === "number" && length > 0) {
      return jsonArray.slice(-length);
    }

    return jsonArray; // Return all objects if length is not provided or invalid
  } catch (error) {
    console.error("Error reading JSON file:", error);
    return []; // Return empty array if there's an error
  }
}

function returnMsgArr({
  dirPath,
  lengthNum,
  trainData,
  functionArr,
  allowTask,
  nodes,
}) {
  const data = readJSONFile(dirPath, lengthNum || 2);

  const filterOnlyText = data?.filter((x) => x.type == "text");

  const filterArr = filterOnlyText.map((i) => {
    return {
      role: i?.route == "incoming" ? "user" : "assistant",
      content: i?.type === "text" ? i?.msgContext?.text ?? "" : "",
    };
  });

  const trainObj = {
    role: "system",
    content: trainData || "You are helpful assistant",
  };

  const actualMessage = [trainObj, ...filterArr];

  return { msgArr: actualMessage, funArr: null };
}

function openAiResponse({
  openAiKey,
  msgArr,
  functionArr,
  allowTask,
  openAiModel,
}) {
  return new Promise(async (resolve) => {
    try {
      const url = "https://api.openai.com/v1/chat/completions";
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiKey}`,
      };

      // Prepare the request body
      const body = {
        model: openAiModel,
        messages: msgArr,
        //   ...(functionArr?.length > 0 &&
        //     allowTask && {
        //       functions: functionArr,
        //       function_call: "auto",
        //     }),
      };

      const response = await fetch(url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body),
      });

      const responseData = await response.json();

      if (responseData?.error || responseData?.choices?.length < 1) {
        resolve({
          success: false,
          msg: responseData?.error?.message || "Error found in OpenAI keys",
        });
      } else {
        resolve({
          success: true,
          msg: responseData.choices[0].message?.content,
          function:
            responseData.choices[0].message?.function_call?.name || false,
        });
      }
    } catch (err) {
      console.log(`Error found in openAiResponse() ai.js`, err);
      resolve({
        success: false,
        msg: "An error occurred while processing the request.",
      });
    }
  });
}

async function replyByOpenAi({
  uid,
  msgObj,
  toJid,
  saveObj,
  chatId,
  session,
  sessionId,
  nodes,
}) {
  // 2 sec delay so that local json updates
  await new Promise((resolve) => setTimeout(resolve, 2000));
  if (!session) {
    return {
      success: false,
      msg: "Instance not found. Please try again",
    };
  }
  const dirPath = `${__dirname}/../conversations/inbox/${uid}/${chatId}.json`;

  const k = nodes?.find((x) => x.type === "AI");

  const { msgArr } = returnMsgArr({
    dirPath: dirPath,
    allowTask: false,
    functionArr: [],
    lengthNum: k?.data?.msgContent?.history || 2,
    trainData: k?.data?.msgContent?.trainText,
    nodes: [],
  });

  console.log({ msgCon: k?.data?.msgContent });

  const resp = await openAiResponse({
    openAiKey: k?.data?.msgContent?.keys,
    allowTask: false,
    functionArr: null,
    msgArr: msgArr,
    openAiModel: k?.data?.msgContent?.aiMode,
  });

  msgObj = {
    text: resp?.msg || JSON.stringify(msg),
  };

  const msg = await session.sendMessage(toJid, msgObj);
  if (msg?.key?.id) {
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

      return { success: true };
    } else {
      return { success: false };
    }
  } else {
    return { success: false };
  }
}

module.exports = { replyByOpenAi };
