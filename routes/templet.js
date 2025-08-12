const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const bcrypt = require("bcrypt");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const moment = require("moment");
const {
  isValidEmail,
  encodeObject,
  readJSONFile,
  getFileExtension,
  areMobileNumbersFilled,
} = require("../functions/function.js");
const randomstring = require("randomstring");
const { getSession } = require("../middlewares/req.js");
const csv = require("csv-parser");
const mime = require("mime-types");
const { checkPlanExpiry } = require("../middlewares/planValidator.js");

// adding one
router.post("/add_new", validateUser, checkPlanExpiry, async (req, res) => {
  try {
    const { title, type, content } = req.body;

    if (!title || !type || !content) {
      return res.json({
        msg: "Title is required",
      });
    }

    await query(
      `INSERT INTO templet (uid, content, type, title) VALUES (?,?,?,?)`,
      [req.decode.uid, JSON.stringify(content), type, title]
    );

    res.json({
      success: true,
      msg: "Templet was saved",
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get my templet
router.get("/my_templet", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM templet WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// del a templet
router.post("/del_templet", validateUser, async (req, res) => {
  try {
    const { id } = req.body;

    await query(`DELETE FROM templet WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);

    res.json({
      msg: "Templet was deleted",
      success: true,
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

module.exports = router;
