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
  getUserOrderssByMonth,
  updateUserPlan,
  sendEmail,
  rzCapturePayment,
} = require("../functions/function.js");
const randomstring = require("randomstring");
const { getSession, sendMessage } = require("../middlewares/req.js");
const csv = require("csv-parser");
const mime = require("mime-types");
const Stripe = require("stripe");
const {
  checkPlanExpiry,
  checkWarmerInPlan,
  checkPhonebookContactLimit,
} = require("../middlewares/planValidator.js");
const { recoverEmail } = require("../emails/returnEmails.js");
const fetch = require("node-fetch");
const { Zarinpal, setting } = require("./zarnipal.js");
const { addON } = require("../env.js");

router.get("/poll", async (req, res) => {
  try {
    const sid =
      "eyJ1aWQiOiJOQXhkY0loTmI0cVlJUUJYd2VSejJ0N2d3V3h2ZUZFaSIsImNsaWVudF9pZCI6ImEifQ==";
    const session = await getSession(sid);

    const send = await sendMessage(session, "918430088300@s.whatsapp.net", {
      poll: {
        name: "pollName",
        values: ["option1", "option2", "option3"],
        selectableCount: 1,
      },
    });
    res.json(send);
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// signup user
router.post("/signup", async (req, res) => {
  try {
    const { email, name, password, mobile, acceptPolicy } = req.body;

    if (!email || !name || !password || !mobile) {
      return res.json({ msg: "Please fill the details", success: false });
    }

    if (!acceptPolicy) {
      return res.json({
        msg: "You did not click on checkbox of Privacy & Terms",
        success: false,
      });
    }

    if (!isValidEmail(email)) {
      return res.json({ msg: "Please enter a valid email", success: false });
    }

    // check if user already has same email
    const findEx = await query(
      `SELECT * FROM user WHERE email = ?`,
      email?.toLowerCase()
    );
    if (findEx.length > 0) {
      return res.json({ msg: "A user already exist with this email" });
    }

    const haspass = await bcrypt.hash(password, 10);
    const uid = randomstring.generate();

    await query(
      `INSERT INTO user (name, uid, email, password, mobile) VALUES (?,?,?,?,?)`,
      [name, uid, email?.toLowerCase(), haspass, mobile]
    );

    const [smtp] = await query(`SELECT * FROM smtp`, []);
    const getWebPublic = await query(`SELECT * FROM web_public`, []);

    console.log({
      email,
      name,
      mobile,
    });

    if (smtp?.email && smtp?.host && smtp?.port && smtp?.password) {
      console.log("EMAIL SENDING");
      await sendEmail(
        smtp?.host,
        smtp?.port,
        smtp?.email,
        smtp?.password,
        getWebPublic[0]?.welcome_email_html
          ?.replace("{{name}}", name || "")
          ?.replace("{{mobile}}", mobile || "")
          ?.replace("{{email}}", email?.toLowerCase() || "") || "WELCOME",
        smtp?.email,
        getWebPublic[0]?.app_name || "App Name",
        email?.toLowerCase()
      );
    }

    if (parseInt(getWebPublic[0]?.auto_trial_active) > 0) {
      // getting free plan
      const getPlan = await query(
        `SELECT * FROM plan WHERE price = ? AND price_crosed = ?`,
        [0, 0]
      );
      await query(`UPDATE user SET trial = ? WHERE uid = ?`, [1, uid]);
      if (getPlan.length > 0) {
        // setting free plan to user
        await updateUserPlan(getPlan[0], uid);
      }
    }

    res.json({ msg: "Signup Success", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// login user
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.json({
        success: false,
        msg: "Please provide email and password",
      });
    }

    // check for user
    const userFind = await query(`SELECT * FROM user WHERE email = ?`, [
      email?.toLowerCase(),
    ]);
    if (userFind.length < 1) {
      return res.json({ msg: "Invalid credentials" });
    }

    const compare = await bcrypt.compare(password, userFind[0].password);

    if (!compare) {
      return res.json({ msg: "Invalid credentials" });
    } else {
      const token = sign(
        {
          uid: userFind[0].uid,
          role: "user",
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
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

router.get("/get_me", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM user WHERE uid = ?`, [
      req.decode.uid,
    ]);

    res.json({
      data: data[0],
      success: true,
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get chats convo
router.post("/get_convo", validateUser, async (req, res) => {
  try {
    const { chatId } = req.body;

    const filePath = `${__dirname}/../conversations/inbox/${req.decode.uid}/${chatId}.json`;
    await query(`UPDATE chats SET is_opened = ? WHERE chat_id = ?`, [
      1,
      chatId,
    ]);

    const data = readJSONFile(filePath, 100);
    res.json({ data, success: true });
  } catch (err) {
    console.log(err);
    res.json({ err, success: false, msg: "Something went wrong", err });
  }
});

// get my instances
router.get("/get_instance", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM instance WHERE uid = ?`, [
      req.decode.uid,
    ]);

    res.json({
      data:
        data.length > 0
          ? data?.map((i) => {
              return {
                ...i,
                qr: "",
              };
            })
          : [],
      success: true,
    });
  } catch (err) {
    console.log(err);
    res.json({ err, success: false, msg: "Something went wrong", err });
  }
});

router.post("/change_chat_ticket_status", validateUser, async (req, res) => {
  try {
    const { status, chatId } = req.body;

    if (!status || !chatId) {
      return res.json({ msg: "invalid request" });
    }

    await query(`UPDATE chats SET chat_status = ? WHERE chat_id = ?`, [
      status,
      chatId,
    ]);

    res.json({
      success: true,
      msg: "Chat status updated",
    });
  } catch (err) {
    console.log(err);
    res.json({ err, success: false, msg: "Something went wrong", err });
  }
});

router.post("/return_url", validateUser, async (req, res) => {
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

    const url = `${process.env.FRONTENDURI}/media/${filename}`;
    console.log({
      originalName: file.name,
    });
    res.json({
      success: true,
      url,
      originalName: file.name,
      filename,
      mime: mime.lookup(filename),
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// adding new message
router.post(
  "/add_warmer_msg",
  validateUser,
  checkPlanExpiry,
  async (req, res) => {
    try {
      const { msg } = req.body;

      if (!msg) {
        return res.json({ msg: "Please type a message to add" });
      }

      await query(`INSERT INTO warmer_script (message, uid) VALUES (?,?)`, [
        msg,
        req.decode.uid,
      ]);

      res.json({
        success: true,
        msg: "Your message was added",
      });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      console.log(err);
    }
  }
);

// get all msgs
router.get("/get_warmer_msg", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM warmer_script WHERE uid = ?`, [
      req.decode.uid,
    ]);

    res.json({
      data,
      success: true,
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get my warmer
router.get("/get_my_warmer", validateUser, async (req, res) => {
  try {
    const { uid } = req.decode;

    const getWarmer = await query(`SELECT * FROM warmers WHERE uid = ?`, [uid]);

    if (getWarmer?.length < 1) {
      await query(
        `INSERT INTO warmers (uid, instances, is_active) VALUES (?,?,?)`,
        [uid, JSON.stringify([]), 1]
      );

      // getting warmer again
      const warmer = await query(`SELECT * FROM warmers WHERE uid = ?`, [uid]);

      warmer[0].instances = JSON.parse(warmer[0].instances);
      res.json({ data: warmer[0], success: true });
    } else {
      getWarmer[0].instances = JSON.parse(getWarmer[0].instances);

      res.json({ data: getWarmer[0], success: true });
    }
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// change warmer status
router.post(
  "/change_status",
  validateUser,
  checkPlanExpiry,
  checkWarmerInPlan,
  async (req, res) => {
    try {
      const { status } = req.body;

      await query(`UPDATE warmers SET is_active = ? WHERE uid = ?`, [
        status ? 1 : 0,
        req.decode.uid,
      ]);

      res.json({ msg: "Status updated", success: true });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      console.log(err);
    }
  }
);

// add to warmer
router.post(
  "/add_ins_to_warm",
  validateUser,
  checkPlanExpiry,
  checkWarmerInPlan,
  async (req, res) => {
    try {
      const { instance } = req.body;

      const getWarm = await query(`SELECT * FROM warmers WHERE uid = ?`, [
        req.decode.uid,
      ]);

      const addedIns = JSON.parse(getWarm[0]?.instances);

      if (addedIns.includes(instance)) {
        const finalIns = addedIns.filter((i) => i !== instance);

        await query(`UPDATE warmers SET instances = ? WHERE uid = ?`, [
          JSON.stringify(finalIns),
          req.decode.uid,
        ]);
      } else {
        const fiIns = [...addedIns, instance];
        await query(`UPDATE warmers SET instances = ? WHERE uid = ?`, [
          JSON.stringify(fiIns),
          req.decode.uid,
        ]);
      }

      res.json({
        msg: "Warmer updated",
        success: true,
      });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      console.log(err);
    }
  }
);

// adding phonebook
router.post(
  "/add_phonebook",
  validateUser,
  checkPlanExpiry,
  async (req, res) => {
    try {
      const { title } = req.body;
      if (!title) {
        return res.json({ msg: "Please give a title to the phonebook" });
      }

      // check already
      const alreadyExisted = await query(
        `SELECT * FROM phonebook WHERE title = ?`,
        [title]
      );

      if (alreadyExisted.length > 0) {
        return res.json({ msg: "Duplicate phonebook title found" });
      }

      const ran = randomstring.generate(5);

      await query(
        `INSERT INTO phonebook (uid, title, phonebook_id) VALUES (?,?,?)`,
        [req.decode.uid, title, ran]
      );

      res.json({ msg: "Phonebook was added", success: true });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      console.log(err);
    }
  }
);

// get my phonebook
router.get("/get_phonebooks", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM phonebook WHERE uid = ?`, [
      req.decode.uid,
    ]);

    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// del a book
router.post("/del_book", validateUser, checkPlanExpiry, async (req, res) => {
  try {
    const { id } = req.body;

    // getting phone book
    const [book] = await query(`SELECT * FROM phonebook WHERE id = ?`, [id]);

    await query(`DELETE FROM phonebook WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);

    await query(`DELETE FROM contact WHERE phonebook_id = ? AND uid = ?`, [
      book?.phonebook_id,
      req.decode.uid,
    ]);

    res.json({ msg: "Phonebook was deleted", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

function filterAndPrefixNumbers(input, prefix) {
  // Check if the prefix is a valid number and not null or undefined
  const isValidPrefix =
    typeof prefix === "number" ||
    (!isNaN(prefix) && prefix !== null && prefix !== undefined);

  // Split the input string into an array using various delimiters
  const arr = input.split(/[\n,]+/);

  // Filter out only valid number strings and add the prefix if it's valid
  return arr
    .filter((element) => !isNaN(element) && element.trim() !== "")
    .map((number) =>
      isValidPrefix ? `${prefix}${number.trim()}` : number.trim()
    );
}

// adding contacts by pasting it
router.post(
  "/add_contact_paste",
  validateUser,
  checkPlanExpiry,
  checkPhonebookContactLimit,
  async (req, res) => {
    try {
      const { numArr, phonebook_name, id, prefix } = req.body;

      if (!numArr || !phonebook_name || !id) {
        return res.json({
          success: false,
          msg: "Please pass at least 1 number",
        });
      }

      const numberArryWithPrifix = filterAndPrefixNumbers(numArr, prefix);

      if (numberArryWithPrifix > req.contactLimit) {
        return res.json({
          success: false,
          msg: "You don't have enough contact limit to add these numbers",
        });
      }

      if (!numberArryWithPrifix.length) {
        return res.json({
          success: false,
          msg: "None of the numbers found valid",
        });
      }

      // Flatten the array of numbers into an array of values for SQL insertion
      const values = numberArryWithPrifix.map((x) => [
        req.decode.uid, // assuming uid is available
        id,
        phonebook_name,
        "NA",
        x,
      ]);

      // Execute the query
      await query(
        `INSERT INTO contact (uid, phonebook_id, phonebook_name, name, mobile) VALUES ?`,
        [values]
      );

      res.json({ success: true, msg: "All Valid Contacts were inserted" });
    } catch (err) {
      res.json({ success: false, msg: "Something went wrong", err });
      console.log(err);
    }
  }
);

// adding a contact
router.post(
  "/add_contact",
  validateUser,
  checkPlanExpiry,
  checkPhonebookContactLimit,
  async (req, res) => {
    try {
      const {
        phonebook_id,
        phonebook_name,
        mobile,
        name,
        var1,
        var2,
        var3,
        var4,
        var5,
      } = req.body;

      if (!name || !mobile || !phonebook_id || !phonebook_name) {
        return res.json({ msg: "Contact name and mobile is required" });
      }

      await query(
        `INSERT INTO contact (
            phonebook_name,
            phonebook_id,
            uid,
            name,
            mobile,
            var_one,
            var_two,
            var_three,
            var_four,
            var_five
        ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          phonebook_name,
          phonebook_id,
          req.decode.uid,
          name,
          mobile,
          var1,
          var2,
          var3,
          var4,
          var5,
        ]
      );

      res.json({
        msg: "Contact was added",
        success: true,
      });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      console.log(err);
    }
  }
);

// get all contacts
router.get("/get_contacts", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM contact WHERE uid = ?`, [
      req.decode.uid,
    ]);

    const contacLimit = req?.user
      ? parseInt(JSON.parse(req?.user?.plan)?.phonebook_contact_limit || 0)
      : 0;

    res.json({ data, success: true, contacLimit });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// dele contcats
router.post(
  "/del_contacts",
  validateUser,
  checkPlanExpiry,
  async (req, res) => {
    try {
      await query(`DELETE FROM contact WHERE id IN (?)`, [req.body.selected]);
      res.json({ success: true, msg: "Contact(s) was deleted" });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong" });
      console.log(err);
    }
  }
);

function parseCSVFile(fileData) {
  return new Promise((resolve, reject) => {
    const results = [];

    // Check if file data is provided
    if (!fileData) {
      resolve(null);
      return;
    }

    const stream = require("stream");
    const bufferStream = new stream.PassThrough();

    // Convert file data (Buffer) to a readable stream
    bufferStream.end(fileData);

    // Use csv-parser to parse the CSV data
    bufferStream
      .pipe(csv())
      .on("data", (data) => {
        // Push each row of data to the results array
        results.push(data);
      })
      .on("end", () => {
        // Resolve the promise with the parsed CSV data
        resolve(results);
      })
      .on("error", (error) => {
        // Reject the promise if there is an error
        resolve(null);
      });
  });
}

// import contcats
router.post(
  "/import_contacts",
  validateUser,
  checkPlanExpiry,
  checkPhonebookContactLimit,
  async (req, res) => {
    try {
      if (!req.files || Object.keys(req.files).length === 0) {
        return res.json({ success: false, msg: "Please select a csv file" });
      }

      const { id, phonebook_name } = req.body;

      const csvData = await parseCSVFile(req.files.file.data);
      if (!csvData) {
        return res.json({ success: false, msg: "Invalid CSV provided" });
      }

      const cvalidateMobile = areMobileNumbersFilled(csvData);
      if (!cvalidateMobile) {
        return res.json({
          msg: "Please check your CSV there one or more mobile not filled",
          csvData,
        });
      }

      // Flatten the array of objects into an array of values
      const values = csvData.map((item) => [
        req.decode.uid, // assuming uid is available in each item
        id,
        phonebook_name,
        item.name,
        item.mobile,
        item.var1,
        item.var2,
        item.var3,
        item.var4,
        item.var5,
      ]);

      // Execute the query
      await query(
        `INSERT INTO contact (uid, phonebook_id, phonebook_name, name, mobile, var_one, var_two, var_three, var_four, var_five) VALUES ?`,
        [values]
      );

      res.json({ success: true, msg: "Contacts were inserted" });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong" });
      console.log(err);
    }
  }
);

// getn api token
router.get(
  "/gen_api_token",
  validateUser,
  checkPlanExpiry,
  async (req, res) => {
    try {
      const token = sign(
        { uid: req.decode.uid, role: "user" },
        process.env.JWTKEY,
        {}
      );

      await query(`UPDATE user SET token = ? WHERE uid = ?`, [
        token,
        req.decode.uid,
      ]);

      res.json({ token, success: true, msg: "Token generated" });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong" });
      console.log(err);
    }
  }
);

// update profile
router.post("/update_profile", validateUser, async (req, res) => {
  try {
    const { newPassword, name, mobile, email } = req.body;

    if (!name || !mobile || !email) {
      return res.json({ msg: "Name, Mobile, Email are required fields" });
    }

    if (newPassword) {
      const hash = await bcrypt.hash(newPassword, 10);
      await query(
        `UPDATE user SET name = ?, email = ?, password = ?, mobile = ?WHERE uid = ?`,
        [name, email, hash, mobile, req.decode.uid]
      );
    } else {
      await query(
        `UPDATE user SET name = ?, email = ?, mobile = ?WHERE uid = ?`,
        [name, email, mobile, req.decode.uid]
      );
    }

    res.json({ success: true, msg: "Profile was updated" });
  } catch (err) {
    console.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

// get plan detail
router.post("/get_plan_details", validateUser, async (req, res) => {
  try {
    const { id } = req.body;

    const data = await query(`SELECT * FROM plan WHERE id = ?`, [id]);
    if (data.length < 1) {
      return res.json({ success: false, data: null });
    } else {
      res.json({ success: true, data: data[0] });
    }
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// get payment gateway
router.get("/get_payment_details", validateUser, async (req, res) => {
  try {
    const resp = await query(`SELECT * FROM web_private`, []);
    let data = resp[0];

    data.pay_stripe_key = "";
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    console.log(err);
  }
});

// creating stripe pay session
router.post("/create_stripe_session", validateUser, async (req, res) => {
  try {
    const getWeb = await query(`SELECT * FROM web_private`, []);

    if (
      getWeb.length < 1 ||
      !getWeb[0]?.pay_stripe_key ||
      !getWeb[0]?.pay_stripe_id
    ) {
      return res.json({
        success: false,
        msg: "Opss.. payment keys found not found",
      });
    }

    const stripeKeys = getWeb[0]?.pay_stripe_key;

    const stripeClient = new Stripe(stripeKeys);

    const { planId } = req.body;

    const plan = await query(`SELECT * FROM plan WHERE id = ?`, [planId]);

    if (plan.length < 1) {
      return res.json({ msg: "No plan found with the id" });
    }

    const randomSt = randomstring.generate();
    const orderID = `STRIPE_${randomSt}`;

    await query(
      `INSERT INTO orders (uid, payment_mode, amount, data) VALUES (?,?,?,?)`,
      [req.decode.uid, "STRIPE", plan[0]?.price, orderID]
    );

    const web = await query(`SELECT * FROM web_public`, []);

    const productStripe = [
      {
        price_data: {
          currency: web[0]?.currency_code,
          product_data: {
            name: plan[0]?.title,
            // images:[product.imgdata]
          },
          unit_amount: plan[0]?.price * 100,
        },
        quantity: 1,
      },
    ];

    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: productStripe,
      mode: "payment",
      success_url: `${process.env.BACKURI}/api/user/stripe_payment?order=${orderID}&plan=${plan[0]?.id}`,
      cancel_url: `${process.env.BACKURI}/api/user/stripe_payment?order=${orderID}&plan=${plan[0]?.id}`,
      locale: process.env.STRIPE_LANG || "en",
    });

    await query(`UPDATE orders SET s_token = ? WHERE data = ?`, [
      session?.id,
      orderID,
    ]);

    res.json({ success: true, session: session });
  } catch (err) {
    res.json({ msg: err.toString(), err });
    console.log({ err, msg: JSON.stringify(err), string: err.toString() });
  }
});

function checlStripePayment(orderId) {
  return new Promise(async (resolve) => {
    try {
      const getStripe = await query(`SELECT * FROM web_private`, []);

      const stripeClient = new Stripe(getStripe[0]?.pay_stripe_key);
      const getPay = await stripeClient.checkout.sessions.retrieve(orderId);

      console.log({ status: getPay?.payment_status });

      if (getPay?.payment_status === "paid") {
        resolve({ success: true, data: getPay });
      } else {
        resolve({ success: false });
      }
    } catch (err) {
      resolve({ success: false, data: {} });
    }
  });
}

function returnHtmlRes(msg) {
  const html = `<!DOCTYPE html>
    <html>
    <head>
      <meta http-equiv="refresh" content="5;url=${process.env.FRONTENDURI}/user">
      <style>
        body {
          font-family: Arial, sans-serif;
          background-color: #f4f4f4;
          text-align: center;
          margin: 0;
          padding: 0;
        }

        .container {
          background-color: #ffffff;
          border: 1px solid #ccc;
          border-radius: 4px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          margin: 100px auto;
          padding: 20px;
          width: 300px;
        }

        p {
          font-size: 18px;
          color: #333;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <p>${msg}</p>
      </div>
    </body>
    </html>
    `;
  return html;
}

router.get("/stripe_payment", async (req, res) => {
  try {
    console.log("HEY");
    const { order, plan } = req.query;

    if (!order || !plan) {
      return res.send("INVALID REQUEST");
    }

    const getOrder = await query(`SELECT * FROM orders WHERE data = ?`, [
      order || "",
    ]);
    const getPlan = await query(`SELECT * FROM plan WHERE id = ?`, [plan]);

    if (getOrder.length < 1) {
      return res.send("Invalid payment found");
    }

    if (getPlan.length < 1) {
      return res.send("Invalid plan found");
    }

    const checkPayment = await checlStripePayment(getOrder[0]?.s_token);
    console.log({ checkPayment: checkPayment });

    if (checkPayment.success) {
      res.send(returnHtmlRes("Payment Success! Redirecting..."));

      await query(`UPDATE orders SET data = ? WHERE data = ?`, [
        JSON.stringify(checkPayment?.data),
        order,
      ]);

      await updateUserPlan(getPlan[0], getOrder[0]?.uid);
    } else {
      res.send(
        "Payment Failed! If the balance was deducted please contact to the HamWiz support. Redirecting..."
      );
    }
  } catch (err) {
    console.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

// pay with paystack
router.post("/pay_with_paystack", validateUser, async (req, res) => {
  try {
    const { planData, trans_id, reference } = req.body;

    if (!planData || !trans_id) {
      return res.json({
        msg: "Order id and plan required",
      });
    }

    // getting plan
    const plan = await query(`SELECT * FROM plan WHERE id = ?`, [planData.id]);

    if (plan.length < 1) {
      return res.json({ msg: "Sorry this plan was not found" });
    }

    // gettings paystack keys
    const getWebPrivate = await query(`SELECT * FROM web_private`, []);
    const paystackSecretKey = getWebPrivate[0]?.pay_paystack_key;
    const paystackId = getWebPrivate[0]?.pay_paystack_id;

    if (!paystackSecretKey || !paystackId) {
      return res.json({ msg: "Paystack credentials not found" });
    }

    var response = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    const resp = await response.json();

    if (resp.data?.status !== "success") {
      res.json({ success: false, msg: `${resp.message} - Ref:-${reference}` });
      return;
    }

    await query(
      `INSERT INTO orders (uid, payment_mode, amount, data) VALUES (?,?,?,?)`,
      [req.decode.uid, "PAYSTACK", plan[0]?.price, reference]
    );

    await updateUserPlan(plan[0], req.decode.uid);

    res.json({
      success: true,
      msg: "Payment success! Redirecting...",
    });
  } catch (err) {
    console.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

router.get("/get_dashboard", validateUser, async (req, res) => {
  try {
    const getOpenChat = await query(
      `SELECT * FROM chats WHERE uid = ? AND chat_status = ?`,
      [req.decode.uid, "open"]
    );
    const getOpenPending = await query(
      `SELECT * FROM chats WHERE uid = ? AND chat_status = ?`,
      [req.decode.uid, "pending"]
    );
    const getOpenResolved = await query(
      `SELECT * FROM chats WHERE uid = ? AND chat_status = ?`,
      [req.decode.uid, "solved"]
    );

    const getActiveChatbots = await query(
      `SELECT * FROM chatbot WHERE active = ? AND uid = ?`,
      [1, req.decode.uid]
    );
    const getDActiveChatbots = await query(
      `SELECT * FROM chatbot WHERE active = ? AND uid = ?`,
      [0, req.decode.uid]
    );

    const opened = getUserOrderssByMonth(getOpenChat);
    const pending = getUserOrderssByMonth(getOpenPending);
    const resolved = getUserOrderssByMonth(getOpenResolved);
    const activeBot = getUserOrderssByMonth(getActiveChatbots);
    const dActiveBot = getUserOrderssByMonth(getDActiveChatbots);

    // get total chats
    const totalChats = await query(`SELECT * FROM chats WHERE uid = ?`, [
      req.decode.uid,
    ]);
    const totalChatbots = await query(`SELECT * FROM chatbot WHERE uid = ?`, [
      req.decode.uid,
    ]);
    const totalContacts = await query(`SELECT * FROM contact WHERE uid = ?`, [
      req.decode.uid,
    ]);
    const totalFlows = await query(`SELECT * FROM flow WHERE uid = ?`, [
      req.decode.uid,
    ]);
    const totalBroadcast = await query(
      `SELECT * FROM broadcast WHERE uid = ?`,
      [req.decode.uid]
    );
    const totalTemplets = await query(`SELECT * FROM templet WHERE uid = ?`, [
      req.decode.uid,
    ]);

    res.json({
      success: true,
      opened,
      pending,
      resolved,
      activeBot,
      dActiveBot,
      totalChats: totalChats.length,
      totalChatbots: totalChatbots?.length,
      totalContacts: totalContacts?.length,
      totalFlows: totalFlows?.length,
      totalBroadcast: totalBroadcast?.length,
      totalTemplets: totalTemplets?.length,
    });
  } catch (err) {
    console.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

// send recover
router.post("/send_resovery", async (req, res) => {
  try {
    const { email } = req.body;

    if (!isValidEmail(email)) {
      return res.json({ msg: "Please enter a valid email" });
    }

    const checkEmailValid = await query(`SELECT * FROM user WHERE email = ?`, [
      email,
    ]);
    if (checkEmailValid.length < 1) {
      return res.json({
        success: true,
        msg: "We have sent a recovery link if this email is associated with user account.",
      });
    }

    const getWeb = await query(`SELECT * FROM web_public`, []);
    const appName = getWeb[0]?.app_name;

    const jsontoken = sign(
      {
        old_email: email,
        email: email,
        time: moment(new Date()),
        password: checkEmailValid[0]?.password,
        role: "user",
      },
      process.env.JWTKEY,
      {}
    );

    console.log({
      jsontoken,
    });

    const recpveryUrl = `${process.env.FRONTENDURI}/recovery-user?token=${jsontoken}`;

    const getHtml = recoverEmail(appName, recpveryUrl);

    // getting smtp
    const smtp = await query(`SELECT * FROM smtp`, []);
    if (
      !smtp[0]?.email ||
      !smtp[0]?.host ||
      !smtp[0]?.port ||
      !smtp[0]?.password
    ) {
      return res.json({
        success: false,
        msg: "SMTP connections not found! Unable to send recovery link",
      });
    }

    await sendEmail(
      smtp[0]?.host,
      smtp[0]?.port,
      smtp[0]?.email,
      smtp[0]?.password,
      getHtml,
      `${appName} - Password Recovery`,
      smtp[0]?.email,
      email
    );

    res.json({
      success: true,
      msg: "We have sent your a password recovery link. Please check your email",
    });
  } catch (err) {
    console.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

// modify recpvery passwrod
router.get("/modify_password", validateUser, async (req, res) => {
  try {
    const { pass } = req.query;

    if (!pass) {
      return res.json({ success: false, msg: "Please provide a password" });
    }

    if (moment(req.decode.time).diff(moment(new Date()), "hours") > 1) {
      return res.json({ success: false, msg: "Token expired" });
    }

    const hashpassword = await bcrypt.hash(pass, 10);

    const result = await query(`UPDATE user SET password = ? WHERE email = ?`, [
      hashpassword,
      req.decode.old_email,
    ]);

    res.json({
      success: true,
      msg: "Your password has been changed. You may login now! Redirecting...",
      data: result,
    });
  } catch (err) {
    console.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

// edit phonebook
router.post("/update_phonebook", validateUser, async (req, res) => {
  try {
    const { id, newTitle, title, phonebook_id } = req.body;

    if (!id || !newTitle) {
      return res.json({
        success: false,
        msg: "Please enter phonebook title",
      });
    }

    // getting already
    const getExist = await query(
      `SELECT * FROM phonebook WHERE title = ? AND uid = ?`,
      [newTitle, req.decode.uid]
    );

    if (getExist?.length > 0) {
      if (getExist[0]?.id !== id) {
        return res.json({
          msg: "Duplicate phonebook found title found",
        });
      }
    }

    // updating phonebok
    await query(
      `UPDATE phonebook SET title = ?, uid = ? WHERE phonebook_id = ?`,
      [newTitle, req.decode.uid, phonebook_id]
    );

    // updating in contacts
    await query(
      `UPDATE contact SET phonebook_name = ? WHERE uid = ? AND phonebook_id = ?`,
      [newTitle, req.decode.uid, phonebook_id]
    );

    res.json({
      success: true,
      msg: "Phonebook was updated",
    });
  } catch (err) {
    console.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

// update contact number
router.post("/update_contact_number", validateUser, async (req, res) => {
  try {
    const {
      name,
      mobile,
      var_one,
      var_two,
      var_three,
      var_four,
      var_five,
      id,
    } = req.body;

    if (!name || !mobile) {
      return res.json({
        success: false,
        msg: "Name and mobile is required",
      });
    }

    await query(
      `UPDATE contact SET
            name = ?,
            mobile = ?,
            var_one = ?,
            var_two = ?,
            var_three = ?,
            var_four = ?,
            var_five = ?
            WHERE id = ?`,
      [name, mobile, var_one, var_two, var_three, var_four, var_five, id]
    );

    res.json({
      success: true,
      msg: "Contact was updated",
    });
  } catch (err) {
    console.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

router.post("/pay_with_rz", validateUser, async (req, res) => {
  try {
    const { rz_payment_id, plan, amount } = req.body;
    if (!rz_payment_id || !plan || !amount) {
      return res.json({ msg: "please send required fields" });
    }

    // getting plan
    const getPlan = await query(`SELECT * FROM plan WHERE id = ?`, [plan?.id]);

    if (getPlan.length < 1) {
      return res.json({
        msg: "Invalid plan found",
      });
    }

    // getting private web
    const [webPrivate] = await query(`SELECT * from web_private`, []);
    const [webPublic] = await query(`SELECT * FROM web_public`, []);

    const rzId = webPrivate?.rz_id;
    const rzKeys = webPrivate?.rz_key;

    if (!rzId || !rzKeys) {
      return res.json({
        msg: `Please fill your razorpay credentials! rzId${rzId} rzKeys${rzKeys}`,
      });
    }

    const finalamt =
      (parseInt(amount) / parseInt(webPublic.exchange_rate)) * 80;

    const resp = await rzCapturePayment(
      rz_payment_id,
      Math.round(finalamt) * 100,
      rzId,
      rzKeys
    );

    if (!resp) {
      res.json({ success: false, msg: resp.description });
      return;
    }

    await updateUserPlan(getPlan[0], req.decode.uid);

    await query(
      `INSERT INTO orders (uid, payment_mode, amount, data) VALUES (?,?,?,?)`,
      [req.decode.uid, "RAZORPAY", plan?.price, JSON.stringify(resp)]
    );

    res.json({
      success: true,
      msg: "Thank for your payment you are good to go now.",
    });
  } catch (err) {
    res.json({ msg: err.toString(), err });
    console.log({ err, msg: JSON.stringify(err), string: err.toString() });
  }
});

// del warmer msg
router.post("/del_warmer_msg", validateUser, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM warmer_script WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);

    res.json({ msg: "Msg was deleted", success: true });
  } catch (err) {
    res.json({ msg: err.toString(), err });
    console.log({ err, msg: JSON.stringify(err), string: err.toString() });
  }
});

// pay with zarnipal
router.post("/get_zarnipal_url", validateUser, async (req, res) => {
  try {
    const { plan, description, amount } = req.body;

    console.log({ plan, description, amount });

    if (!amount || !description || !plan) {
      return res.json({ msg: "please send required fields" });
    }

    const [getWebPvt] = await query(`SELECT * FROM web_private`, []);
    const [web] = await query(`SELECT * FROM web_public`, []);
    if (!getWebPvt?.zarnipal) {
      return res.json({ msg: "Zarnipal keys not not found" });
    }

    const zarniId = getWebPvt?.zarnipal;

    const zarinpal = new setting(zarniId, false);
    const finalAmount = (plan.price / web?.exchange_rate || 1) * 80;

    const authority = await zarinpal.requestPayment({
      amount: Math.round(finalAmount),
      callbackUrl:
        process.env.BACKURI +
        `/api/user/verify_zarnipal?uid=${req.decode.uid}&plan_id=${plan.id}`,
      description: plan.title,
    });

    const redirect = zarinpal.startPayUrl + authority;
    res.json({ success: true, url: redirect });
  } catch (err) {
    res.json({ msg: err.toString(), err });
    console.log({ err, msg: JSON.stringify(err), string: err.toString() });
  }
});

router.post("/verify_zarnipal", async (req, res) => {
  try {
    if (!req.query.Authority) {
      res.json({ success: false, msg: "Invalid request" });
    }

    const plan_id = req.query.plan_id;

    const getPlan = await query(`SELECT * FROM plan WHERE id = ?`, [plan_id]);

    if (getPlan.length < 1) {
      return res.json({
        msg: "This plan was not found. Contact custom support.",
      });
    }
    const [web] = await query(`SELECT * FROM web_public`, []);
    const [getWebPvt] = await query(`SELECT * FROM web_private`, []);
    const zarniId = getWebPvt?.zarnipal;

    const finalAmount = (plan.price / web?.exchange_rate || 1) * 80;

    const zarinpal = new setting(zarniId, false);

    const refId = await zarinpal.verifyPayment({
      authority: req.query.Authority,
      amount: finalAmount,
    });

    await updateUserPlan(getPlan[0], req.query.uid);

    await query(
      `INSERT INTO orders (uid, payment_mode, amount, data) VALUES (?,?,?,?)`,
      [req.query.uid, "ZARNIPAL", plan?.price, JSON.stringify(refId)]
    );

    if (refId) {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta http-equiv="refresh" content="5;url=${process.env.FRONTENDURI}/user">
          <style>
        body {
          font-family: Arial, sans-serif;
          background-color: #f4f4f4;
          text-align: center;
          margin: 0;
          padding: 0;
        }
        .container {
          background-color: #ffffff;
          border: 1px solid #ccc;
          border-radius: 4px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          margin: 100px auto;
          padding: 20px;
          width: 300px;
        }
        h1 {
          font-size: 24px;
          color: #333;
        }
        p {
          font-size: 18px;
          color: #333;
        }
          </style>
        </head>
        <body>
          <div class="container">
        <h1>Payment Success</h1>
        <p>You can login to your account now. Redirecting...</p>
          </div>
        </body>
        </html>
      `);
    }
  } catch (err) {
    res.json({ msg: err.toString(), err });
    console.log({ err, msg: JSON.stringify(err), string: err.toString() });
  }
});

// checking for ai plugin
router.get("/check_ai_plugin", async (req, res) => {
  try {
    if (addON?.includes("AI_BOT")) {
      res.json({ success: true, msg: "YES" });
    } else {
      res.json({ success: true, msg: "NO" });
    }
  } catch (err) {
    res.json({ msg: err.toString(), err });
    console.log({ err, msg: JSON.stringify(err), string: err.toString() });
  }
});

module.exports = router;
