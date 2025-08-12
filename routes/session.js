const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const bcrypt = require("bcrypt");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const moment = require("moment");
const {
  isValidEmail,
  encodeObject,
  decodeObject,
  readJsonFileContact,
} = require("../functions/function.js");
const randomstring = require("randomstring");
const {
  createSession,
  sendMessage,
  getSession,
  formatPhone,
  deleteSession,
} = require("../middlewares/req.js");
const { fetchProfileUrl } = require("../functions/control.js");
const {
  checkPlanExpiry,
  checkForSessions,
} = require("../middlewares/planValidator.js");

// create sessios
router.post(
  "/create_qr",
  validateUser,
  checkPlanExpiry,
  checkForSessions,
  async (req, res) => {
    try {
      const { title, syncMax } = req.body;

      if (!title) {
        return res.json({ msg: "Please give instance a name" });
      }

      const sessionId = encodeObject({
        uid: req.decode.uid,
        client_id: title,
      });

      console.log({
        sessionId,
        obj: {
          uid: req.decode.uid,
          client_id: title,
        },
      });

      await query(
        `INSERT INTO instance (uid, instance_id, title, status) VALUES (?,?,?,?)`,
        [req.decode.uid, sessionId, title, "CREATED"]
      );

      createSession(sessionId, false, req, res, false, syncMax);
    } catch (err) {
      res.json({ success: false, msg: "something went wrong" });
      console.log(err);
    }
  }
);

// get session status
router.post("/status", validateUser, async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.json({ msg: "Session id not found" });
    }

    const states = ["connecting", "connected", "disconnecting", "disconnected"];

    const session = await getSession(id);

    if (!session) {
      return res.json({
        msg: "Invalid session found",
        success: false,
      });
    }

    let state = states[session.ws.readyState];

    state =
      state === "connected" &&
      typeof (session.isLegacy ? session.state.legacy.user : session.user) !==
        "undefined"
        ? "authenticated"
        : state;

    const userData = session?.authState?.creds?.me || session.user;
    const status = session.user ? true : false;

    await query(
      `UPDATE instance SET userData = ?, jid = ? WHERE instance_id = ?`,
      [JSON.stringify(userData), extractPhoneNumber(userData?.id), id]
    );

    const getDb = await query(`SELECT * FROM instance WHERE instance_id = ?`, [
      id,
    ]);

    res.json({
      success: true,
      status,
      userData,
      qr: getDb?.length > 0 ? getDb[0]?.qr : null,
      webhook: getDb?.length > 0 ? getDb[0]?.webhook : null,
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

function extractPhoneNumber(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(?=:|\@)/);
  return match ? match[1] : null;
}

// get instances with status
router.get("/get_instances_with_status", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM instance WHERE uid = ?`, [
      req.decode.uid,
    ]);
    if (data.length < 1) {
      return res.json({
        success: true,
        data: [],
      });
    } else {
      const instances = await Promise.all(
        data.map(async (i) => {
          const states = [
            "connecting",
            "connected",
            "disconnecting",
            "disconnected",
          ];

          const session = await getSession(i?.instance_id);

          if (!session) {
            return {
              session: null,
              success: false,
            };
          }

          let state = states[session.ws.readyState];

          state =
            state === "connected" &&
            typeof (session.isLegacy
              ? session.state.legacy.user
              : session.user) !== "undefined"
              ? "authenticated"
              : state;

          const userData = session?.authState?.creds?.me || session.user;
          const status = session.user ? true : false;

          await query(
            `UPDATE instance SET userData = ?, jid = ? WHERE instance_id = ?`,
            [
              JSON.stringify(userData),
              extractPhoneNumber(userData?.id),
              i?.instance_id,
            ]
          );

          return {
            success: true,
            status,
            userData,
            i,
          };
        })
      );

      // Filter out instances where status is false
      const filteredInstances = instances.filter((instance) => instance.status);

      res.json({
        data: filteredInstances,
        success: true,
      });
    }
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// del instance
router.post("/del_ins", validateUser, async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.json({ msg: "Invalid request" });
    }

    const chekSession = await getSession(id);

    if (!chekSession) {
      await query(`DELETE FROM instance WHERE instance_id = ?`, [id]);
      return res.json({ msg: "Session was deleted", success: true });
    }

    const session = getSession(id);

    try {
      await session.logout();
    } catch {
    } finally {
      deleteSession(id, session?.isLegacy);
      await query(`DELETE FROM instance WHERE instance_id = ?`, [id]);
    }

    res.json({
      success: true,
      msg: "Instnace was deleted",
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// get user instances
router.get("/get_mine", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM instance WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// get my contacts list
router.post("/instance_contact", validateUser, async (req, res) => {
  try {
    const { instance } = req.body;

    if (!instance) {
      return res.json({ msg: "Invalid request" });
    }

    const filePathOne = `${__dirname}/../contacts/${instance}__one.json`;

    const filePathTwo = `${__dirname}/../contacts/${instance}__two.json`;

    const contactsOne = readJsonFileContact(filePathOne);
    const contactsTwo = readJsonFileContact(filePathTwo);

    const session = await getSession(instance);

    if (!session) {
      return res.json({ msg: "This session is either busy or invalid" });
    }

    const totalContacts = [...contactsOne, ...contactsTwo];

    // const promises = totalContacts.map(async (i) => {
    //     const profileImg = await fetchProfileUrl(session, i?.id, true)
    //     return {
    //         ...i,
    //         profileImg: profileImg
    //     }
    // })

    // const contacts = await Promise.all(promises);

    console.log({
      totalContacts,
    });

    res.json({ data: totalContacts, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// change instance status
router.post("/change_instance_status", validateUser, async (req, res) => {
  try {
    const statuses = [
      "unavailable",
      "available",
      "composing",
      "recording",
      "paused",
    ];

    const { insId, status, jid } = req.body;

    const session = await getSession(insId);

    if (!session) {
      return res.json({
        msg: "Unable to change status right now WA is busy",
      });
    }

    if (!statuses.includes(status)) {
      return res.json({
        msg: "Invalid status found",
      });
    }

    await session.sendPresenceUpdate(status);
    await query(`UPDATE instance SET a_status = ? WHERE instance_id = ?`, [
      status,
      insId,
    ]);

    res.json({
      success: true,
      msg: "Updated",
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// update weboook url
router.post("/update_webhook_url", validateUser, async (req, res) => {
  try {
    const { webhook, instance_id } = req.body;

    if (!webhook) {
      return res.json({ msg: "Please enter webhook URL" });
    }

    await query(
      `UPDATE instance SET webhook = ? WHERE instance_id = ? AND uid = ?`,
      [webhook, instance_id, req.decode.uid]
    );
    res.json({ success: true, msg: "Webhook url updated" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

module.exports = router;
