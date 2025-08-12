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
  sendEmail,
  getUserSignupsByMonth,
  getUserOrderssByMonth,
} = require("../functions/function.js");
const randomstring = require("randomstring");
const { getSession } = require("../middlewares/req.js");
const csv = require("csv-parser");
const mime = require("mime-types");

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.json({
        success: false,
        msg: "Please fill email and password",
      });
    }
    // check for user
    const userFind = await query(`SELECT * FROM admin WHERE email = ?`, [
      email,
    ]);
    if (userFind.length < 1) {
      return res.json({ msg: "Invalid credentials found" });
    }

    const compare = await bcrypt.compare(password, userFind[0].password);
    if (!compare) {
      return res.json({ msg: "Invalid credentials" });
    } else {
      const token = sign(
        {
          uid: userFind[0].uid,
          role: "admin",
          password: userFind[0].password,
          email: userFind[0].email,
        },
        process.env.JWTKEY,
        {}
      );
      res.json({
        success: true,
        token,
      });
    }
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// get all users
router.get("/all_users", adminValidator, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM user`, []);
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// update user
router.post("/update_user", adminValidator, async (req, res) => {
  try {
    const { newPassword, name, email, mobile, uid } = req.body;

    if (!uid || !name || !email || !mobile) {
      return res.json({
        success: false,
        msg: "You forgot to enter some field(s)",
      });
    }

    const findUserByEmail = await query(`SELECT * FROM user WHERE email = ?`, [
      email,
    ]);
    if (findUserByEmail.length > 0 && findUserByEmail[0].uid !== uid) {
      return res.json({ msg: "This email is already taken by another user" });
    }

    const findUserByUid = await query(`SELECT * FROM user WHERE uid = ?`, [
      uid,
    ]);
    if (findUserByUid.length === 0) {
      return res.json({ msg: "User not found" });
    }

    if (newPassword) {
      const hashpass = await bcrypt.hash(newPassword, 10);

      await query(
        `UPDATE user SET name = ?, email = ?, password = ?, mobile = ? WHERE uid = ?`,
        [name, email, hashpass, mobile, uid]
      );
    } else {
      await query(
        `UPDATE user SET name = ?, email = ?, mobile = ? WHERE uid = ?`,
        [name, email, mobile, uid]
      );
    }

    res.json({ msg: "User was updated", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// del user
router.post("/del_user", adminValidator, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM user WHERE id = ?`, [id]);
    res.json({ success: true, msg: "User was deletd" });
  } catch (err) {
    console.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

// update admin
router.post("/update-admin", adminValidator, async (req, res) => {
  try {
    if (req.body.newpass) {
      const hash = await bcrypt.hash(req.body.newpass, 10);
      await query(`UPDATE admin SET email = ?, password = ? WHERE uid = ?`, [
        req.body.email,
        hash,
        req.decode.uid,
      ]);
      res.json({ success: true, msg: "Admin was updated refresh the page" });
    } else {
      await query(`UPDATE admin SET email = ? WHERE uid = ?`, [
        req.body.email,
        req.decode.uid,
      ]);
      res.json({ success: true, msg: "Admin was updated refresh the page" });
    }
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
});

// get admin
router.get("/get_admin", adminValidator, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM admin`, []);
    res.json({ data: data[0], success: true });
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
});

// get payment gateway admin
router.get("/get_payment_gateway_admin", adminValidator, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM web_private`, []);
    if (data.length < 1) {
      return res.json({ data: {}, success: true });
    }
    res.json({ data: data[0], success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// update payment gateway
router.post("/update_pay_gateway", adminValidator, async (req, res) => {
  try {
    const {
      pay_offline_id,
      pay_offline_key,
      offline_active,
      pay_stripe_id,
      pay_stripe_key,
      stripe_active,
      pay_paystack_id,
      pay_paystack_key,
      paystack_active,
      rz_active,
      rz_id,
      rz_key,
      zarnipal,
      zarnipal_active,
    } = req.body;

    await query(
      `UPDATE web_private SET  
            pay_offline_id = ?, 
            pay_offline_key = ?, 
            offline_active = ?, 
            pay_stripe_id = ?, 
            pay_stripe_key = ?, 
            stripe_active = ?,
            pay_paystack_id = ?,
            pay_paystack_key = ?,
            paystack_active = ?,
            rz_active = ?,
            rz_id = ?,
            rz_key = ?,
            zarnipal = ?,
            zarnipal_active = ?`,
      [
        pay_offline_id,
        pay_offline_key,
        offline_active,
        pay_stripe_id,
        pay_stripe_key,
        stripe_active,
        pay_paystack_id,
        pay_paystack_key,
        parseInt(paystack_active) > 0 ? 1 : 0,
        rz_active,
        rz_id,
        rz_key,
        zarnipal,
        parseInt(zarnipal_active) > 0 ? 1 : 0,
      ]
    );

    res.json({ success: true, msg: "Payment gateway updated" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// get all brands
router.get("/get_brands", async (req, res) => {
  try {
    const data = await query(`SELECT * FROM partners`, []);
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// add partners logo
router.post("/add_brand_image", adminValidator, async (req, res) => {
  try {
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.json({ success: false, msg: "No files were uploaded" });
    }

    const randomString = randomstring.generate();
    const file = req.files.file;

    const filename = `${randomString}.${getFileExtension(file.name)}`;

    file.mv(`${__dirname}/../client/public/media/${filename}`, (err) => {
      if (err) {
        console.log(err);
        return res.json({ err });
      }
    });

    await query(`INSERT INTO partners (filename) VALUES (?)`, [filename]);

    res.json({ success: true, msg: "Logo was uploaded" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// del image
router.post("/del_brand_logo", adminValidator, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE from partners WHERE id = ?`, [id]);

    res.json({ success: true, msg: "Bran was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// get all faq
router.get("/get_faq", async (req, res) => {
  try {
    const data = await query(`SELECT * FROM faq`, []);
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// add faq
router.post("/add_faq", adminValidator, async (req, res) => {
  try {
    const { question, answer } = req.body;

    if (!answer || !question) {
      return res.json({
        success: false,
        msg: "Please provide question and answer both",
      });
    }

    await query(`INSERT INTO faq (question, answer) VALUES (?,?)`, [
      question,
      answer,
    ]);

    res.json({ success: true, msg: "Faq was added" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// del faq
router.post("/del_faq", adminValidator, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM faq WHERE id = ?`, [id]);
    res.json({ success: true, msg: "Faq was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// add page
router.post("/add_page", adminValidator, async (req, res) => {
  try {
    const { title, content, slug } = req.body;

    if (!title || !content || !slug) {
      return res.json({ success: false, msg: "Please fill all fields" });
    }

    if (!req.files || Object.keys(req.files).length === 0) {
      return res.json({ success: false, msg: "No image was selected" });
    }

    // checking few pages
    const pageAlready = [
      "contact-form",
      "privacy-policy",
      "terms-and-conditions",
    ];

    if (pageAlready.includes(slug)) {
      return res.json({
        msg: "This slug is already used by system please use another slug.",
      });
    }

    // checking already one
    const getPage = await query(`SELECT * FROM page WHERE slug = ?`, [slug]);
    if (getPage.length > 0) {
      return res.json({
        success: false,
        msg: "Thi slug was already used by another page.",
      });
    }

    const randomString = randomstring.generate();
    const file = req.files.file;

    const filename = `${randomString}.${getFileExtension(file.name)}`;

    file.mv(`${__dirname}/../client/public/media/${filename}`, (err) => {
      if (err) {
        console.log(err);
        return res.json({ err });
      }
    });

    await query(
      `INSERT INTO page (slug, title, image, content) VALUES (?,?,?,?)`,
      [slug, title, filename, content]
    );

    res.json({ success: true, msg: "Page was added" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// get all contact forms
router.get("/get_contact_leads", adminValidator, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM contact_form`, []);
    res.json({ data, success: true });
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
});

// del contact entry
router.post("/del_cotact_entry", adminValidator, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM contact_form WHERE id = ?`, [id]);
    res.json({ success: true, msg: "Entry was deleted" });
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
});

// get orders
router.get("/get_orders", adminValidator, async (req, res) => {
  try {
    const data = await query(
      `
            SELECT 
                orders.id,
                orders.uid,
                orders.payment_mode,
                orders.amount,
                orders.data,
                orders.createdAt,
                orders.s_token AS orderCreatedAt,
                user.role,
                user.name,
                user.email,
                user.password AS userCreatedAt
            FROM orders
            LEFT JOIN user ON orders.uid = user.uid
        `,
      []
    );

    res.json({ data, success: true });
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
});

// get all pages
router.get("/get_pages", async (req, res) => {
  try {
    const data = await query(`SELECT * FROM page WHERE permanent = ?`, [0]);
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// del page
router.post("/del_page", adminValidator, async (req, res) => {
  try {
    const { id } = req.body;

    await query(`DELETE FROM page WHERE id = ?`, [id]);
    res.json({ success: true, msg: "Page was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// get page by slug
router.post("/get_page_slug", async (req, res) => {
  try {
    const { slug } = req.body;

    const data = await query(`SELECT * FROM page WHERE slug = ?`, [slug]);
    if (data.length < 1) {
      return res.json({ data: {}, success: true, page: false });
    } else {
      return res.json({ data: data[0], success: true, page: true });
    }
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
});
// update termns
router.post("/update_terms", adminValidator, async (req, res) => {
  try {
    const { title, content } = req.body;

    // check
    const getPP = await query(`SELECT * FROM page WHERE slug = ?`, [
      "terms-and-conditions",
    ]);

    if (getPP.length > 0) {
      await query(`UPDATE page SET title = ?, content = ? WHERE slug = ?`, [
        title,
        content,
        "terms-and-conditions",
      ]);
    } else {
      await query(
        `INSERT INTO page (slug, title, content, permanent) VALUES (?,?,?,?)`,
        ["terms-and-conditions", title, content, 1]
      );
    }

    res.json({ success: true, msg: "Page updated" });
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
});

// update privacy policy
router.post("/update_privacy_policy", adminValidator, async (req, res) => {
  try {
    const { title, content } = req.body;

    // check
    const getPP = await query(`SELECT * FROM page WHERE slug = ?`, [
      "privacy-policy",
    ]);

    if (getPP.length > 0) {
      await query(`UPDATE page SET title = ?, content = ? WHERE slug = ?`, [
        title,
        content,
        "privacy-policy",
      ]);
    } else {
      await query(
        `INSERT INTO page (slug, title, content, permanent) VALUES (?,?,?,?)`,
        ["privacy-policy", title, content, 1]
      );
    }

    res.json({ success: true, msg: "Page updated" });
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
});

// get all testi
router.get("/get_testi", async (req, res) => {
  try {
    const data = await query(`SELECT * FROM testimonial`, []);
    res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
});

// del testi
router.post("/del_testi", adminValidator, async (req, res) => {
  try {
    const { id } = req.body;

    await query(`DELETE FROM testimonial WHERE id = ?`, [id]);
    res.json({ success: true, msg: "Testimonial was deleted" });
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
});

// ading testtimonial
router.post("/add_testimonial", adminValidator, async (req, res) => {
  try {
    const { title, description, reviewer_name, reviewer_position } = req.body;

    if (!title || !description || !reviewer_name || !reviewer_position) {
      return res.json({ success: false, msg: "Please fill all fields" });
    }

    await query(
      `INSERT INTO testimonial (title, description, reviewer_name, reviewer_position) VALUES (?,?,?,?)`,
      [title, description, reviewer_name, reviewer_position]
    );

    res.json({ success: true, msg: "Testimonial was added" });
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
});

// auto user login
router.post("/auto_login", adminValidator, async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.json({ success: false, msg: "Invalid input" });
    }

    const user = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);
    const token = sign(
      {
        uid: user[0].uid,
        role: "user",
        password: user[0].password,
        email: user[0].email,
      },
      process.env.JWTKEY,
      {}
    );
    console.log(token);
    res.json({
      success: true,
      token: token,
    });
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
});

// get smtp
router.get("/get_smtp", adminValidator, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM smtp`, []);
    if (data.length < 1) {
      return res.json({ data: { id: "ID" }, success: true });
    } else {
      return res.json({ data: data[0], success: true });
    }
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
});

// update smtp
router.post("/update_smtp", adminValidator, async (req, res) => {
  try {
    const { email, port, password, host } = req.body;

    if (!email || !port || !password || !host) {
      return res.json({ msg: "Please fill all the fields" });
    }

    const getOne = await query(`SELECT * FROM smtp`, []);
    if (getOne.length < 1) {
      await query(
        `INSERT INTO smtp (email, host, port, password) VALUES (?,?,?,?)`,
        [email, host, port, password]
      );
    } else {
      await query(
        `UPDATE smtp SET email = ?, host = ?, port = ?, password = ?`,
        [email, host, port, password]
      );
    }

    res.json({ success: true, msg: "Email settings was updated" });
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
});

// send test email
router.post("/send_test_email", adminValidator, async (req, res) => {
  try {
    const { email, port, password, host, to } = req.body;

    if (!email || !port || !password || !host) {
      return res.json({ msg: "Please fill all the fields" });
    }

    const checkEmail = await sendEmail(
      host,
      port,
      email,
      password,
      `<h1>This is a test SMTP email!</h1>`,
      "SMTP Testing",
      "Testing Sender",
      to
    );

    if (checkEmail.success) {
      res.json({ msg: "Email sent", success: true });
    } else {
      res.json({ msg: checkEmail?.err });
    }
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
});

// get dashboard user
router.get("/get_dashboard_for_user", adminValidator, async (req, res) => {
  try {
    const getUsers = await query(`SELECT * FROM user`, []);
    const { paidSignupsByMonth, unpaidSignupsByMonth } =
      getUserSignupsByMonth(getUsers);
    const getTotalInstance = await query(`SELECT * FROM instance`, []);

    const getOrders = await query(`SELECT * FROM orders`, []);
    const orders = getUserOrderssByMonth(getOrders);

    const getContactForm = await query(`SELECT * FROM contact_form`, []);

    res.json({
      data: {
        paid: paidSignupsByMonth,
        unpaid: unpaidSignupsByMonth,
        orders,
        userLength: getUsers.length,
        orderLength: getOrders.length,
        contactLength: getContactForm.length,
        instanceTotal: getTotalInstance?.length,
      },
      success: true,
    });
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
});

module.exports = router;
