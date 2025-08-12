const { query } = require("../database/dbpromise");
const { getSession, isExists } = require("../middlewares/req");

// Timeout promise function to reject if the operation takes too long
function timeoutPromise(promise, ms) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Operation timed out")), ms)
  );
  return Promise.race([promise, timeout]);
}

function mergeObjects(arrayA, arrayB, idKey, passedNameKey) {
  const mergedArray = [];
  for (let objA of arrayA) {
    const matchingObjects = arrayB.filter((obj) => obj[idKey] === objA[idKey]);
    if (matchingObjects.length > 0) {
      const mergedObject = { ...objA };
      mergedObject[passedNameKey] = matchingObjects;
      mergedArray.push(mergedObject);
    } else {
      mergedArray.push(objA);
    }
  }
  return mergedArray;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomNumberBetween(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

function getRandomElementFromArray(array, exclude) {
  const filteredArray = array.filter((item) => item !== exclude);
  const randomIndex = Math.floor(Math.random() * filteredArray.length);
  return filteredArray[randomIndex];
}

async function sendTyping(session, jid) {
  try {
    await timeoutPromise(session.sendPresenceUpdate("composing", jid), 5000);
  } catch (error) {
    console.error("Error sending 'composing' presence:", error);
  }

  // Wait for a random delay before sending the "paused" status
  await delay(getRandomNumberBetween(1000, 3000));

  try {
    await timeoutPromise(session.sendPresenceUpdate("paused", jid), 5000);
  } catch (error) {
    console.error("Error sending 'paused' presence:", error);
  }
}

async function getWarmerFromDB() {
  const warmer = await query(`SELECT * FROM warmers WHERE is_active = ?`, [1]);
  const warmerScript = await query(`SELECT * FROM warmer_script`, []);
  return mergeObjects(warmer, warmerScript, "uid", "script");
}

async function checkPlanAndAction(uid) {
  try {
    const user = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);
    if (!user || user.length < 1) {
      await query(`UPDATE warmers SET is_active = ? WHERE uid = ?`, [0, uid]);
      console.log("User not found, turning warmer off");
      return false;
    } else {
      const plan = user[0]?.plan ? JSON.parse(user[0].plan) : {};
      if (parseInt(plan?.wa_warmer) > 0) {
        return true;
      } else {
        console.log("Warmer not found in the plan, turning off");
        await query(`UPDATE warmers SET is_active = ? WHERE uid = ?`, [0, uid]);
        return false;
      }
    }
  } catch (err) {
    console.log("ERROR FOUND IN checkPlanAndAction", err);
    return false;
  }
}

async function runWarmer(warmer) {
  try {
    const instanceArr = JSON.parse(warmer?.instances);
    const scriptArr = warmer?.script;
    if (instanceArr.length > 1) {
      await checkPlanAndAction(warmer?.uid);

      const instanceFrom = getRandomElementFromArray(instanceArr);
      const script = getRandomElementFromArray(scriptArr);
      const instanceTo = getRandomElementFromArray(instanceArr, instanceFrom);

      // Getting the target instance from DB
      const instanceToObj = await query(
        `SELECT * FROM instance WHERE instance_id = ?`,
        [instanceTo]
      );

      // Get the session with a timeout
      let session;
      try {
        session = await timeoutPromise(getSession(instanceFrom), 15000);
      } catch (error) {
        console.error(
          `Error getting session for instance ${instanceFrom}:`,
          error
        );
        return;
      }

      if (session && instanceToObj && instanceToObj.length > 0) {
        console.log({ instanceToObj });
        let exist;
        try {
          exist = await timeoutPromise(
            isExists(session, instanceToObj[0]?.jid, false),
            5000
          );
        } catch (error) {
          console.error(
            `Error checking existence for jid ${instanceToObj[0]?.jid}:`,
            error
          );
          return;
        }
        if (exist) {
          const to = `${instanceToObj[0]?.jid}@s.whatsapp.net`;
          const msg = {
            text: script?.message,
          };

          console.log({ to });
          await sendTyping(session, instanceToObj[0]?.jid);
          try {
            await timeoutPromise(session.sendMessage(to, msg), 10000);
          } catch (error) {
            console.error(`Error sending message to ${to}:`, error);
          }
        } else {
          console.log(`Jid ${instanceToObj[0]?.jid} does not exist`);
        }
      } else {
        console.log("Session not found for", instanceFrom);
        console.log(`Session not found: ${instanceFrom}`);
      }
    }
  } catch (err) {
    console.log("Error found in runWarmer", err);
  }
}

function delayRandom(fromSeconds, toSeconds) {
  const randomSeconds = Math.random() * (toSeconds - fromSeconds) + fromSeconds;
  console.log(`Random Delay: ${randomSeconds} sec`);
  return new Promise((resolve) => setTimeout(resolve, randomSeconds * 1000));
}

async function warmerLoopInit() {
  try {
    const warmers = await getWarmerFromDB();
    console.log(JSON.stringify(warmers));
    if (warmers.length > 0) {
      // Use allSettled so that one user's failure doesn't block others
      const promises = warmers.map((warmer) => runWarmer(warmer));
      await Promise.allSettled(promises);
    }
  } catch (err) {
    console.log("Error in warmerLoopInit:", err);
  } finally {
    await delay(2000);
    warmerLoopInit();
  }
}

module.exports = { warmerLoopInit };
