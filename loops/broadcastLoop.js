const { query } = require("../database/dbpromise");
const { decodeObject, mergeVariables } = require("../functions/function");
const { getSession, isExists } = require("../middlewares/req");
const moment = require("moment-timezone");

function getRandomElementFromArray(array, exclude) {
  const filteredArray = array.filter((item) => item !== exclude);
  const randomIndex = Math.floor(Math.random() * filteredArray.length);
  return filteredArray[randomIndex];
}

function hasDatePassedInTimezone(timezone, datetimeFromMySQL) {
  if (!timezone || !datetimeFromMySQL) {
    return true;
  }

  const momentDate = moment.utc(datetimeFromMySQL).tz(timezone);

  if (!momentDate.isValid()) {
    return false;
  }
  const currentMoment = moment.tz(timezone);
  if (!currentMoment.isValid()) {
    return false;
  }
  return momentDate.isBefore(currentMoment);
}

function delayRandom(fromSeconds, toSeconds) {
  const randomSeconds = Math.random() * (toSeconds - fromSeconds) + fromSeconds;

  console.log(`random Delay ${randomSeconds} sec`, {
    fromSeconds,
    toSeconds,
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, randomSeconds * 1000);
  });
}

function resolveTemplet(templet) {
  const type = templet?.type;
  const content = JSON.parse(templet?.content);
  switch (type) {
    case "text":
      return content;
    case "image":
      return {
        image: {
          url: `${__dirname}/../client/public/media/${content?.image?.url}`,
        },
        caption: content?.caption || null,
      };
    case "doc":
      return {
        document: {
          url: `${__dirname}/../client/public/media/${content?.document?.url}`,
        },
        fileName: content?.fileName,
        caption: content?.caption || null,
      };
    case "aud":
      return {
        audio: {
          url: `${__dirname}/../client/public/media/${content?.audio?.url}`,
        },
        fileName: content?.fileName,
        ptt: true,
      };
    case "video":
      return {
        video: {
          url: `${__dirname}/../client/public/media/${content?.video?.url}`,
        },
        caption: content?.caption,
      };
    case "loc":
      return {
        location: {
          degreesLatitude: content?.location?.degreesLatitude,
          degreesLongitude: content?.location?.degreesLongitude,
        },
      };
    case "poll":
      return content;
    default:
      return null;
  }
}

async function getBroadLog() {
  const beforeRes = await query(`SELECT * FROM broadcast WHERE status = ?`, [
    "PENDING",
  ]);

  const res = beforeRes.filter(
    (i) => i.schedule && hasDatePassedInTimezone(i?.timezone, i?.schedule)
  );

  // getting broadcast log
  if (res.length > 0) {
    const promise = res.map(async (i) => {
      const logOne = await query(
        `SELECT * FROM broadcast_log WHERE broadcast_id = ? AND delivery_status = ? LIMIT 1`,
        [i?.broadcast_id, "PENDING"]
      );

      if (logOne.length < 1) {
        console.log("ZERO");
        await query(`UPDATE broadcast SET status = ? WHERE broadcast_id = ?`, [
          "COMPLETED",
          i?.broadcast_id,
        ]);
      }
      return {
        success: logOne.length > 0 ? true : false,
        log: logOne[0],
        i: i,
      };
    });

    const promiseWait = await Promise.all(promise);
    const finalLog = promiseWait.filter((i) => i?.success);

    return finalLog;
  } else {
    return [];
  }
}

function timeoutPromise(promise, ms) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Operation timed out")), ms)
  );
  return Promise.race([promise, timeout]);
}

function formatWhatsAppNumber(number) {
  // Remove any non-digit characters (like spaces, dashes, or parentheses)
  const cleanedNumber = number.replace(/\D/g, "");

  // Add @s.whatsapp.net at the end
  const formattedNumber = `${cleanedNumber}@s.whatsapp.net`;

  return formattedNumber;
}

async function sendMessage(logs) {
  const promise = logs.map(async (log, index) => {
    const i = log?.i;
    const logObj = log?.log;
    try {
      // console.log(`[${index}] 1`);

      console.log({
        delaying: {
          from: i?.delay_from,
          to: i?.delay_to,
        },
      });
      await delayRandom(parseInt(i?.delay_from), parseInt(i?.delay_to));

      const insArr = JSON.parse(i?.instance_id);
      const instanceId = getRandomElementFromArray(insArr);
      const boradCastId = logObj?.id;
      const jid = formatWhatsAppNumber(logObj?.send_to);
      const templet = JSON.parse(log?.i?.templet);

      console.log({ jid });

      // console.log(`[${index}] 2`);

      const session = await timeoutPromise(await getSession(instanceId), 60000);
      console.log("getting session done");

      // console.log(`[${index}] 3`);

      const actualObj = resolveTemplet(templet);

      // console.log(`[${index}] 4`);

      if (!session) {
        // console.log(`[${index}] 5 - Session not found`);
        await query(
          `UPDATE broadcast_log SET delivery_status = ? WHERE id = ?`,
          ["Instance NA", boradCastId]
        );

        await query(`UPDATE broadcast SET status = ? WHERE broadcast_id = ?`, [
          "FAILED INSTANCE MISSING",
          boradCastId,
        ]);
      } else {
        const check = await timeoutPromise(
          isExists(session, jid, false),
          60000
        );
        console.log("number checking done");
        // console.log(`[${index}] Check result: ${check}`);
        if (!check) {
          await query(
            `UPDATE broadcast_log SET delivery_status = ? WHERE id = ?`,
            ["Number NA", boradCastId]
          );
        } else {
          if (actualObj) {
            // adding variables
            const returnObjWithVariables = mergeVariables({
              content: actualObj,
              varJson: JSON.parse(logObj?.contact),
              type: templet?.type?.toLowerCase(),
            });

            console.log({
              returnObjWithVariables,
            });

            const send = await timeoutPromise(
              session.sendMessage(jid, returnObjWithVariables),
              60000
            );

            console.log("msg sent done");

            // console.log(`[${index}] 8 - Message sent`, { send });

            if (send?.key?.id) {
              const { client_id } = await decodeObject(instanceId);

              await query(
                `UPDATE broadcast_log SET delivery_status = ?, msg_id = ?, instance_id = ? WHERE id = ?`,
                ["sent", send?.key?.id, client_id, boradCastId]
              );
            } else {
              // console.log(`[${index}] 8 - Message send failed`);
              await query(
                `UPDATE broadcast_log SET delivery_status = ?, err = ? WHERE broadcast_id = ?`,
                ["failed", send.toString(), boradCastId]
              );
            }
          }

          // console.log(`[${index}] 77`);
        }
      }
    } catch (err) {
      console.log({ logObj });
      console.error(`[${index}] Error:`, err);
      await query(
        `UPDATE broadcast_log SET delivery_status = ?, err = ? WHERE id = ?`,
        ["failed", err.toString(), logObj?.id]
      );
    }
  });
  await Promise.all(promise);
}

const DELAYFROM = 10;
const DELAYTO = 35;

async function broadcastLoopInit() {
  try {
    while (true) {
      const logs = await getBroadLog();

      if (logs && logs.length > 0) {
        console.log("ran loop");
        await sendMessage(logs);
        console.log("loop ended");
      } else {
        // console.log("no broadcast found");
      }

      // await delayRandom(DELAYFROM, DELAYTO);
    }
  } catch (err) {
    console.error("Error in broadcast loop:", err);

    // Optionally, restart the loop after an error
    setTimeout(() => {
      broadcastLoopInit();
    }, 1000);
  }
}

module.exports = { broadcastLoopInit };
