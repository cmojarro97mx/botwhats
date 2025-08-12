const { daysDiff } = require("../functions/function.js");
const { query } = require("../database/dbpromise");

const checkPlanExpiry = async (req, res, next) => {
  try {
    const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [
      req.decode.uid,
    ]);
    const plan = getUser[0].plan;
    if (!plan) {
      return res.json({ msg: "you dont have a plan please buy one" });
    }

    const daysLeft = daysDiff(getUser[0].plan_expire);
    if (daysLeft < 1) {
      return res.json({ msg: "Your plan has been expired please renew." });
    }
    req.user = getUser[0];
    req.planExpire = daysLeft;
    req.plan = JSON.parse(plan);
    next();
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkWarmerInPlan = async (req, res, next) => {
  try {
    const plan = req.plan;

    const waWarmer = parseInt(plan?.wa_warmer) > 0 ? true : false;

    if (waWarmer) {
      next();
    } else {
      return res.json({
        msg: "Your current plan does not allow you to use WhatsApp Warmer",
      });
    }
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkPhonebookContactLimit = async (req, res, next) => {
  try {
    const plan = req.plan;

    const contactLimit =
      plan?.phonebook_contact_limit > 0
        ? parseInt(plan?.phonebook_contact_limit)
        : 0;
    const getUserContact = await query(`SELECT * FROM contact WHERE uid = ?`, [
      req.decode.uid,
    ]);

    if (getUserContact?.length >= contactLimit) {
      return res.json({ msg: "Your phonebook contacts limit was reached" });
    } else {
      req.contactLimit = parseInt(contactLimit);
      next();
    }
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkChatbotPlan = async (req, res, next) => {
  try {
    const plan = req.plan;
    console.log(req.plan);
    console.log(plan);
    if (parseInt(plan?.chatbot) > 0) {
      next();
    } else {
      return res.json({
        msg: "Your current plan does not allow you to make a chatbot",
      });
    }
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkForSessions = async (req, res, next) => {
  try {
    const plan = req.plan;
    const instanceHave = parseInt(plan?.wa_account);
    const getAddedInstances = await query(
      `SELECT * FROM instance WHERE uid = ?`,
      [req.decode.uid]
    );

    if (getAddedInstances?.length <= instanceHave) {
      next();
    } else {
      return res.json({
        success: false,
        msg: `Your instances limits are reached please delete any other instance to add this one or upgrade your plan.`,
      });
    }
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkForAPIAccess = async (req, res, next) => {
  try {
    const apiAccess = parseInt(req.plan?.api_access) > 0 ? true : false;
    if (apiAccess) {
      next();
    } else {
      return res.json({
        success: false,
        msg: `Your plan does not allow you to use API. Please contact support`,
      });
    }
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
};

module.exports = {
  checkPlanExpiry,
  checkWarmerInPlan,
  checkPhonebookContactLimit,
  checkChatbotPlan,
  checkForSessions,
  checkForAPIAccess,
};
