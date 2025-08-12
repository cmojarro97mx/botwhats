const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const bcrypt = require("bcrypt");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const moment = require("moment");
const { makeRequest } = require("../functions/function.js");
const randomstring = require("randomstring");
const { getSession } = require("../middlewares/req.js");
const csv = require("csv-parser");
const mime = require("mime-types");
const {
  checkPlanExpiry,
  checkChatbotPlan,
} = require("../middlewares/planValidator.js");

// add bot
router.post(
  "/add_bot",
  validateUser,
  checkPlanExpiry,
  checkChatbotPlan,
  async (req, res) => {
    try {
      const {
        title,
        for_all,
        prevent_book_id,
        flow,
        instance_id,
        group_reply,
      } = req.body;

      if (!title || !flow || !instance_id) {
        return res.json({
          msg: "Please select the required fields",
        });
      }

      if (!for_all) {
        if (!prevent_book_id) {
          return res.json({
            msg: "Your forgot to select prevent phonebook",
          });
        }
      }
      // check existing bot
      // const getBot = await query(
      //   `SELECT * FROM chatbot WHERE uid = ? AND instance_id = ?`,
      //   [req.decode.uid, instance_id]
      // );

      // if (getBot.length > 0) {
      //   return res.json({
      //     msg: "This instance is already busy with another chtbot",
      //   });
      // }

      await query(
        `INSERT INTO chatbot (uid, title, for_all, prevent_book_id, flow, active, instance_id, group_reply) VALUES (?,?,?,?,?,?,?,?)`,
        [
          req.decode.uid,
          title,
          for_all ? 1 : 0,
          prevent_book_id,
          JSON.stringify(flow),
          1,
          instance_id,
          group_reply ? 1 : 0,
        ]
      );

      res.json({
        success: true,
        msg: "Chatbot was added",
      });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      console.log(err);
    }
  }
);

// update bot
router.post(
  "/update_bot",
  validateUser,
  checkPlanExpiry,
  checkChatbotPlan,
  async (req, res) => {
    try {
      const {
        title,
        for_all,
        prevent_book_id,
        flow,
        instance_id,
        id,
        group_reply,
      } = req.body;

      if (!title || !flow || !instance_id) {
        return res.json({
          msg: "Please select the required fields",
        });
      }

      if (!for_all) {
        if (!prevent_book_id) {
          return res.json({
            msg: "Your forgot to select prevent phonebook",
          });
        }
      }

      // check existing bot
      const getBot = await query(
        `SELECT * FROM chatbot WHERE uid = ? AND instance_id = ?`,
        [req.decode.uid, instance_id]
      );

      if (getBot.length > 0 && parseFloat(id) !== parseFloat(getBot[0]?.id)) {
        return res.json({
          msg: "This instance is already busy with another chtbot",
        });
      }

      await query(
        `UPDATE chatbot SET title = ?, for_all = ?, prevent_book_id = ?, flow = ?,
        instance_id = ?, group_reply = ? WHERE id = ? AND uid = ?`,
        [
          title,
          for_all ? 1 : 0,
          prevent_book_id,
          JSON.stringify(flow),
          instance_id,
          group_reply ? 1 : 0,
          id,
          req.decode.uid,
        ]
      );

      res.json({
        msg: "Chatbot was updated",
        success: true,
      });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      console.log(err);
    }
  }
);

// get my chatbots
router.get("/get_mine", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM chatbot WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// change bot status
router.post(
  "/change_bot_status",
  validateUser,
  checkPlanExpiry,
  checkChatbotPlan,
  async (req, res) => {
    try {
      const { botId, status } = req.body;

      if (!botId) {
        return res.json({ msg: "Invalid request found" });
      }

      await query(`UPDATE chatbot SET active = ? WHERE id = ? AND uid = ?`, [
        status ? 1 : 0,
        botId,
        req.decode.uid,
      ]);

      res.json({ msg: "Acivation changed", success: true });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      console.log(err);
    }
  }
);

// del bot
router.post("/del_bot", validateUser, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM chatbot WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);

    res.json({
      msg: "Chatbot was deleted",
      success: true,
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// del a number from prevent list
router.post("/del_num_from_prevent", validateUser, async (req, res) => {
  try {
    const { id, number } = req.body;

    const getChatbot = await query(
      `SELECT * FROM chatbot WHERE uid = ? AND id = ?`,
      [req.decode.uid, id]
    );

    if (getChatbot?.length < 1) {
      return res.json({ msg: "This chatbot was not found" });
    }

    const preventList = getChatbot[0]?.prevent_reply
      ? JSON.parse(getChatbot[0]?.prevent_reply)
      : [];

    // removing number
    const updatedArr = preventList?.filter((x) => x.mobile !== number);

    await query(`UPDATE chatbot SET prevent_reply = ? WHERE id = ?`, [
      JSON.stringify(updatedArr),
      id,
    ]);

    res.json({ msg: "The number was removed", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// rem number from ai
router.post("/rem_num_ai", validateUser, async (req, res) => {
  try {
    const { number, id } = req.body;

    if (!id || !number) {
      return res.json({ msg: "Invalid request" });
    }

    const getAllNumber = await query(`SELECT * FROM chatbot WHERE id = ?`, [
      id,
    ]);

    const numbersArr = getAllNumber[0]?.ai_chatbot
      ? JSON.parse(getAllNumber[0]?.ai_chatbot)
      : [];

    const arrAfterRemove = numbersArr?.filter((x) => x !== number);
    await query(`UPDATE chatbot SET ai_bot = ? WHERE id = ?`, [
      JSON.stringify(arrAfterRemove),
      id,
    ]);

    res.json({
      msg: "Number was deleted",
      success: true,
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// try to make a request
router.post("/make_request_api", validateUser, async (req, res) => {
  try {
    const { url, body, headers, type } = req.body;

    if (!url || !type) {
      return res.json({ msg: "Url is required" });
    }

    const resp = await makeRequest({
      method: type,
      url,
      body,
      headers,
    });

    res.json(resp);
  } catch (err) {
    console.log(err);
    res.json({ success: false, msg: "Something went wrong", err });
  }
});

module.exports = router;
