const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const bcrypt = require("bcrypt");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const adminValidator = require("../middlewares/admin.js");
const moment = require("moment");
const {
  isValidEmail,
  encodeObject,
  readJSONFile,
  getFileExtension,
  areMobileNumbersFilled,
  updateUserPlan,
} = require("../functions/function.js");
const randomstring = require("randomstring");
const { getSession } = require("../middlewares/req.js");
const csv = require("csv-parser");
const mime = require("mime-types");

// add a plan
router.post("/add_plan", adminValidator, async (req, res) => {
  try {
    const {
      title,
      price,
      price_crosed,
      days,
      des,
      phonebook_contact_limit,
      allow_chat_tags,
      allow_chat_note,
      chatbot,
      api_access,
      trial,
      wa_account,
      wa_warmer,
    } = req.body;

    if (!trial) {
      if (!price || !price_crosed) {
        return res.json({ msg: "Please fill the price" });
      }
    }

    if (!title || !days || !des || !phonebook_contact_limit) {
      return res.json({ msg: "Please fill all the details" });
    }

    await query(
      `INSERT INTO plan (
            title, 
            price, 
            price_crosed,
            days,
            des,
            phonebook_contact_limit,
            allow_chat_tags,
            allow_chat_note,
            chatbot,
            api_access,
            wa_account,
            wa_warmer
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        title,
        trial ? 0 : price,
        trial ? 0 : price_crosed,
        days,
        des,
        phonebook_contact_limit,
        allow_chat_tags ? 1 : 0,
        allow_chat_note ? 1 : 0,
        chatbot ? 1 : 0,
        api_access ? 1 : 0,
        wa_account || 0,
        wa_warmer ? 1 : 0,
      ]
    );

    res.json({
      success: true,
      msg: "Plan was added",
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get all plan
router.get("/get_all", async (req, res) => {
  try {
    const data = await query(`SELECT * FROM plan`, []);
    res.json({ data, success: true });
  } catch (err) {
    res.json({
      success: false,
      msg: "something went wrong",
      err,
      config: {
        connectionLimit: 1000,
        host: process.env.DBHOST || "localhost",
        port: process.env.DBPORT || 3306,
        user: process.env.DBUSER,
        password: process.env.DBPASS,
        database: process.env.DBNAME,
        charset: "utf8mb4",
      },
    });
    console.log(err);
  }
});

// del a plan
router.post("/del_plan", adminValidator, async (req, res) => {
  try {
    const { id } = req.body;

    await query(`DELETE FROM plan WHERE id = ?`, [id]);
    res.json({
      success: true,
      msg: "Plan was deleted",
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// update plan
router.post("/update_plan", adminValidator, async (req, res) => {
  try {
    const { plan, uid } = req.body;

    if (!plan || !uid) {
      return res.json({ success: false, msg: "Invalid input provided" });
    }

    const getPlan = await query(`SELECT * FROM plan WHERE id = ?`, [plan?.id]);
    if (getPlan.length < 1) {
      return res.json({ success: false, msg: "Invalid plan found" });
    }

    await updateUserPlan(getPlan[0], uid);

    res.json({ success: true, msg: "User plan was updated" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// enroll free plan
router.post("/start_free_trial", validateUser, async (req, res) => {
  try {
    const { planId } = req.body;

    const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [
      req.decode.uid,
    ]);

    if (parseInt(getUser[0]?.trial) > 0) {
      return res.json({
        success: false,
        msg: "You have already taken Trial once. You can not enroll for trial again.",
      });
    }

    const getPlan = await query(`SELECT * FROM plan WHERE id = ?`, [planId]);

    if (getPlan.length < 1) {
      return res.json({ msg: "Invalid plan found" });
    }

    if (getPlan[0]?.price > 0) {
      return res.json({ msg: "This plan is not a trial plan." });
    }

    await query(
      `INSERT INTO orders (uid, payment_mode, amount, data) VALUES (?,?,?,?)`,
      [req.decode.uid, "OFFLINE", 0, JSON.stringify({ plan: getPlan[0] })]
    );

    await updateUserPlan(getPlan[0], getUser[0]?.uid);

    await query(`UPDATE user SET trial = ? WHERE uid = ?`, [1, req.decode.uid]);

    res.json({
      success: true,
      msg: "Your trial plan has been activated. You are redirecting to the panel...",
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

module.exports = router;
