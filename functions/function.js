const fs = require("fs");
const mime = require("mime-types");
const randomstring = require("randomstring");
const { query } = require("../database/dbpromise");
const path = require("path");
const { getIOInstance } = require("../socket");
const { getSession } = require("../middlewares/req");
const { fetchProfileUrl, fetchGroupMeta } = require("./control");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const unzipper = require("unzipper");
const fetch = require("node-fetch");

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function daysDiff(timestamp) {
  if (!timestamp) return 0;

  const targetDate = new Date(Number(timestamp));

  // Check if the date is invalid
  if (isNaN(targetDate.getTime())) {
    return 0;
  }

  const currentDate = new Date();
  const timeDifference = targetDate.getTime() - currentDate.getTime();
  const daysDifference = Math.floor(timeDifference / (1000 * 60 * 60 * 24));

  return daysDifference;
}

function sendEmail(host, port, email, pass, html, subject, from, to) {
  return new Promise(async (resolve) => {
    try {
      let transporter = nodemailer.createTransport({
        host: host,
        port: port,
        secure: port === "465" ? true : false, // true for 465, false for other ports
        auth: {
          user: email, // generated ethereal user
          pass: pass, // generated ethereal password
        },
      });

      let info = await transporter.sendMail({
        from: `${from || "Email From"} <${email}>`, // sender address
        to: to, // list of receivers
        subject: subject || "Email", // Subject line
        html: html, // html body
      });

      resolve({ success: true, info });
    } catch (err) {
      resolve({ success: false, err: err.toString() || "Invalid Email" });
    }
  });
}

function decodeObject(encodedString) {
  const jsonString = Buffer.from(encodedString, "base64").toString();
  const obj = JSON.parse(jsonString);
  return obj;
}

function encodeObject(obj) {
  const jsonString = JSON.stringify(obj);
  const base64String = Buffer.from(jsonString).toString("base64");
  return base64String;
}

function encodeChatId(obj) {
  const jsonString = JSON.stringify(obj);
  const base64String = btoa(jsonString); // Convert to base64
  return base64String;
}

function deleteFileIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    // console.log(`${filePath} deleted successfully.`);
  } else {
    // console.log(`${filePath} does not exist. Skipping deletion.`);
  }
}

function mergetMsgTimestamp(messagesArray, newMessage) {
  messagesArray.push(newMessage);
  messagesArray.sort((a, b) => a.timestamp - b.timestamp);
}

function validateArray(inputArray) {
  if (Array.isArray(inputArray)) {
    if (inputArray.length > 0) {
      return inputArray;
    } else {
      return [];
    }
  } else {
    return [];
  }
}

function saveImageToFile(imageBuffer, filePath, mimetype) {
  try {
    // Save the image buffer to a file
    fs.writeFileSync(filePath, imageBuffer);

    console.log(`${mimetype || "IMG"} saved successfully as ${filePath}`);
  } catch (error) {
    console.error(`Error saving image: ${error.message}`);
  }
}

function addObjectToFile(object, filePath) {
  const parentDir = path.dirname(filePath);

  // Check if the parent directory exists
  if (!fs.existsSync(parentDir)) {
    // Create the parent directory if it doesn't exist
    fs.mkdirSync(parentDir, { recursive: true });
  }

  if (fs.existsSync(filePath)) {
    const existingData = JSON.parse(fs.readFileSync(filePath));
    if (Array.isArray(existingData)) {
      existingData.push(object);
      fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));
    } else {
      console.error("File does not contain an array.");
    }
  } else {
    fs.writeFileSync(filePath, JSON.stringify([object], null, 2));
  }
}

function removeNumberAfterColon(str) {
  const colonIndex = str.indexOf(":");
  if (colonIndex !== -1) {
    const atIndex = str.indexOf("@", colonIndex); // Find the index of '@' after ':'
    if (atIndex !== -1) {
      return str.substring(0, colonIndex) + str.substring(atIndex); // Concatenate the substrings before ':' and after '@'
    }
  }
  return str;
}

function updateMessageObjectInFile(filePath, msgId, key, value) {
  // Check if the file path exists
  if (!fs.existsSync(filePath)) {
    console.error("File does not exist:", filePath);
    return;
  }

  // Read JSON data from the file
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading file:", err);
      return;
    }

    try {
      // Parse JSON data
      const dataArray = JSON.parse(data);

      // Find the message object with the given msgId
      const message = dataArray.find((obj) => obj.msgId === msgId);

      // If the message is found, update the key with the new value
      if (message) {
        message[key] = value;
        // console.log(`Updated message with msgId ${msgId}: ${key} set to ${value}`);

        // Write the modified JSON data back to the file
        fs.writeFile(
          filePath,
          JSON.stringify(dataArray, null, 2),
          "utf8",
          (err) => {
            if (err) {
              console.error("Error writing file:", err);
              return;
            }
            // console.log('File updated successfully');
          }
        );
      } else {
        console.error(`Message with msgId ${msgId} not found`);
      }
    } catch (error) {
      console.error("Error parsing JSON:", error);
    }
  });
}

function readJSONFile(filePath, length) {
  try {
    // Check if the file exists
    if (!fs.existsSync(filePath)) {
      console.error("File not found:", filePath);
      return []; // Return empty array if file does not exist
    }

    // Read the file content
    const fileContent = fs.readFileSync(filePath, "utf8");

    // Parse the file content as JSON
    const jsonArray = JSON.parse(fileContent);

    // Check if the parsed content is an array
    if (!Array.isArray(jsonArray)) {
      console.error("Invalid JSON format:", filePath);
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

function getFileExtension(fileName) {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex !== -1 && dotIndex !== 0) {
    const extension = fileName.substring(dotIndex + 1);
    return extension.toLowerCase();
  }
  return "";
}

function getImageAsBase64(imagePath) {
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString("base64");

    return base64Image;
  } catch (error) {
    console.error("Error reading image:", error);
    return null;
  }
}

function areMobileNumbersFilled(array) {
  for (const item of array) {
    if (!item.mobile) {
      return false;
    }
  }

  return true;
}

function writeJsonToFile(filepath, jsonData, callback) {
  return new Promise((resolve, reject) => {
    // Ensure directory structure exists
    const directory = path.dirname(filepath);
    fs.mkdir(directory, { recursive: true }, function (err) {
      if (err) {
        if (callback) {
          callback(err);
        }
        reject(err);
        return;
      }

      // Convert JSON data to string
      const jsonString = JSON.stringify(jsonData, null, 2); // 2 spaces indentation for readability

      // Write JSON data to file, with 'w' flag to overwrite existing file
      fs.writeFile(filepath, jsonString, { flag: "w" }, function (err) {
        if (err) {
          if (callback) {
            callback(err);
          }
          reject(err);
          return;
        }
        const message = `JSON data has been written to '${filepath}'.`;
        if (callback) {
          callback(null, message);
        }
        resolve(message);
      });
    });
  });
}

function readJsonFromFile(filePath) {
  try {
    // Read the file synchronously
    const jsonData = fs.readFileSync(filePath, "utf8");
    // Parse JSON data
    const parsedData = JSON.parse(jsonData);
    // If parsed data is an array, return it, otherwise return an empty array
    return Array.isArray(parsedData) ? parsedData : [];
  } catch (err) {
    // If any error occurs (e.g., file not found or invalid JSON), return an empty array
    console.error(`Error reading JSON file ${filePath}:`, err);
    return [];
  }
}

function decodeToken(token) {
  return new Promise((resolve) => {
    if (!token) {
      return resolve({ success: false, message: "No token found" });
    }

    jwt.verify(token, process.env.JWTKEY, async (err, decode) => {
      if (err) {
        resolve({ success: false, message: "Invalid token found" });
      } else {
        // checking token
        const getUser = await query(`SELECT * FROM user WHERE token = ?`, [
          token,
        ]);

        if (getUser.length < 1) {
          return resolve({
            success: false,
            message: "This token is invalid or expired",
            token,
          });
        }

        resolve({
          success: true,
          user: getUser[0],
          decode,
        });
      }
    });
  });
}

function readJsonFileContact(filePath) {
  try {
    // Synchronously read the file contents
    const fileContent = fs.readFileSync(filePath, "utf8");
    // Parse the JSON content
    const jsonData = JSON.parse(fileContent);
    return jsonData;
  } catch (error) {
    // If there's an error (e.g., file doesn't exist), return an empty array
    return [];
  }
}

function addDaysToCurrentTimestamp(days) {
  // Get the current timestamp
  let currentTimestamp = Date.now();

  // Calculate the milliseconds for the given number of days
  let millisecondsToAdd = days * 24 * 60 * 60 * 1000;

  // Add the milliseconds to the current timestamp
  let newTimestamp = currentTimestamp + millisecondsToAdd;

  // Return the new timestamp
  return newTimestamp;
}

// update user plan
async function updateUserPlan(plan, uid) {
  const planDays = parseInt(plan?.days || 0);
  const timeStamp = addDaysToCurrentTimestamp(planDays);
  await query(`UPDATE user SET plan = ?, plan_expire = ? WHERE uid = ?`, [
    JSON.stringify(plan),
    timeStamp,
    uid,
  ]);
}

function getUserOrderssByMonth(orders) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const signupsByMonth = Array.from({ length: 12 }, (_, monthIndex) => {
    const month = months[monthIndex];
    const ordersInMonth = orders.filter((user) => {
      const userDate = new Date(user.createdAt);
      return (
        userDate.getMonth() === monthIndex &&
        userDate.getFullYear() === currentYear
      );
    });
    const numberOfOders = ordersInMonth.length;
    return { month, numberOfOders };
  });
  return signupsByMonth;
}

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
}

function getUserSignupsByMonth(users) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();

  // Filter users into paid and unpaid arrays
  const { paidUsers, unpaidUsers } = users.reduce(
    (acc, user) => {
      const planExpire = user.plan_expire
        ? new Date(parseInt(user.plan_expire))
        : null;
      const isPaid = planExpire ? planExpire > currentDate : false;
      if (isPaid) {
        acc.paidUsers.push(user);
      } else {
        acc.unpaidUsers.push(user);
      }
      return acc;
    },
    { paidUsers: [], unpaidUsers: [] }
  );

  // Create signups by month for paid users
  const paidSignupsByMonth = months.map((month, monthIndex) => {
    const usersInMonth = paidUsers.filter((user) => {
      const userDate = new Date(user.createdAt);
      return (
        userDate.getMonth() === monthIndex &&
        userDate.getFullYear() === currentYear
      );
    });
    const numberOfSignups = usersInMonth.length;
    const userEmails = usersInMonth.map((user) => user.email);
    return { month, numberOfSignups, userEmails, paid: true };
  });

  // Create signups by month for unpaid users
  const unpaidSignupsByMonth = months.map((month, monthIndex) => {
    const usersInMonth = unpaidUsers.filter((user) => {
      const userDate = new Date(user.createdAt);
      return (
        userDate.getMonth() === monthIndex &&
        userDate.getFullYear() === currentYear
      );
    });
    const numberOfSignups = usersInMonth.length;
    const userEmails = usersInMonth.map((user) => user.email);
    return { month, numberOfSignups, userEmails, paid: false };
  });

  return { paidSignupsByMonth, unpaidSignupsByMonth };
}

async function convertTempletObj(obj, type) {
  let sendObj;
  let msgObj;

  if (type === "text" || type === "loc" || type === "poll") {
    sendObj = obj;
    msgObj = obj;
  } else if (type === "image") {
    sendObj = {
      image: {
        url: `${__dirname}/../client/public/media/${obj?.image?.url}`,
      },
      caption: obj?.caption || null,
      jpegThumbnail: getImageAsBase64(
        `${__dirname}/../client/public/media/${obj?.image?.url}`
      ),
      fileName: obj?.document?.url,
    };
    msgObj = {
      caption: obj?.caption,
      fileName: obj?.image?.url,
      mimetype: obj?.mimetype,
    };
  } else if (type === "doc") {
    sendObj = {
      document: {
        url: `${__dirname}/../client/public/media/${obj?.document?.url}`,
      },
      caption: obj?.caption || null,
      fileName: obj?.fileName || null,
    };

    msgObj = {
      caption: obj?.caption || null,
      fileName: obj?.document?.url,
      mimetype: obj?.mimetype,
    };
  } else if (type === "aud") {
    sendObj = {
      audio: {
        url: `${__dirname}/../client/public/media/${obj?.audio?.url}`,
      },
      ptt: true,
      fileName: obj?.fileName || null,
    };
    msgObj = {
      caption: "",
      fileName: obj?.audio?.url,
    };
  } else if (type === "video") {
    sendObj = {
      video: {
        url: `${__dirname}/../client/public/media/${obj?.video?.url}`,
      },
      caption: obj?.caption || null,
    };
    msgObj = {
      caption: obj?.caption,
      fileName: obj?.video?.url,
      mimetype: obj?.mimetype,
    };
  } else {
    sendObj = obj;
    msgObj = obj;
  }

  return { sendObj, msgObj, type: type };
}

function folderExists(folderPath) {
  try {
    // Check if the folder exists/Users/hamidsaifi/Desktop/projects/wa-crm-doc/client/public/logo192.png /Users/hamidsaifi/Desktop/projects/wa-crm-doc/client/public/logo512.png
    fs.accessSync(folderPath, fs.constants.F_OK);
    return true;
  } catch (error) {
    // Folder does not exist or inaccessible
    return false;
  }
}

async function downloadAndExtractFile(filesObject, outputFolderPath) {
  try {
    // Access the uploaded file from req.files
    const uploadedFile = filesObject.file;
    if (!uploadedFile) {
      return { success: false, msg: "No file data found in FormData" };
    }

    // Create a writable stream to save the file
    const outputPath = path.join(outputFolderPath, uploadedFile.name);

    // Move the file to the desired location
    await new Promise((resolve, reject) => {
      uploadedFile.mv(outputPath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // Extract the downloaded file
    await fs
      .createReadStream(outputPath)
      .pipe(unzipper.Extract({ path: outputFolderPath })) // Specify the output folder path for extraction
      .promise();

    // Delete the downloaded zip file after extraction
    fs.unlinkSync(outputPath);

    return { success: true, msg: "App was successfully installed/updated" };
  } catch (error) {
    console.error("Error downloading and extracting file:", error);
    return { success: false, msg: error.message };
  }
}

function replaceVariables(string, variables) {
  return string?.replace(/{(.*?)}/g, (match, variable) => {
    const value = variables[variable.trim()];
    return value !== undefined ? value : match;
  });
}

function mergeVariables({ content = {}, varJson = {}, type = "string" }) {
  const commonTypes = ["image", "doc", "video"];

  if (type === "text") {
    content = {
      ...content,
      text: replaceVariables(content?.text, varJson),
    };
  } else if (commonTypes.includes(type)) {
    content = {
      ...content,
      caption: replaceVariables(content?.caption, varJson),
    };
  } else if (type === "poll") {
    content = {
      ...content,
      poll: {
        ...content?.poll,
        name: replaceVariables(content?.poll?.name, varJson),
      },
    };
  }

  return content;
}

const rzCapturePayment = (paymentId, amount, razorpayKey, razorpaySecret) => {
  // Disable SSL certificate validation
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  const auth =
    "Basic " +
    Buffer.from(razorpayKey + ":" + razorpaySecret).toString("base64");

  return new Promise((resolve, reject) => {
    fetch(`https://api.razorpay.com/v1/payments/${paymentId}/capture`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: amount }), // Replace with the actual amount to capture
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.error) {
          console.error("Error capturing payment:", data.error);
          reject(data.error);
        } else {
          console.log("Payment captured successfully:", data);
          resolve(data);
        }
      })
      .catch((error) => {
        console.error("Error capturing payment:", error);
        reject(error);
      });
  });
};

async function makeRequest({ method, url, body = null, headers = [] }) {
  try {
    // Create an AbortController to handle the timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 seconds

    // Convert headers array to an object
    const headersObject = headers.reduce((acc, { key, value }) => {
      acc[key] = value;
      return acc;
    }, {});

    // Convert body array to an object if it's not GET or DELETE
    const requestBody =
      method === "GET" || method === "DELETE"
        ? undefined
        : JSON.stringify(
            body.reduce((acc, { key, value }) => {
              acc[key] = value;
              return acc;
            }, {})
          );

    // Set up the request configuration
    const config = {
      method,
      headers: headersObject,
      body: requestBody,
      signal: controller.signal,
    };

    console.log({
      config,
    });

    // Perform the request
    const response = await fetch(url, config);

    // Clear the timeout
    clearTimeout(timeoutId);

    // Check if the response status is OK
    if (!response.ok) {
      return { success: false, msg: `HTTP error ${response.status}` };
    }

    // Parse the response
    const data = await response.json();

    // Validate the response
    if (typeof data === "object" || Array.isArray(data)) {
      return { success: true, data };
    } else {
      return { success: false, msg: "Invalid response format" };
    }
  } catch (error) {
    // Handle errors (e.g., timeout, network issues)
    return { success: false, msg: error.message };
  }
}

module.exports = {
  isValidEmail,
  decodeObject,
  encodeObject,
  deleteFileIfExists,
  mergetMsgTimestamp,
  validateArray,
  saveImageToFile,
  readJSONFile,
  updateMessageObjectInFile,
  addObjectToFile,
  encodeChatId,
  removeNumberAfterColon,
  getFileExtension,
  getImageAsBase64,
  areMobileNumbersFilled,
  writeJsonToFile,
  readJsonFromFile,
  decodeToken,
  readJsonFileContact,
  updateUserPlan,
  getUserOrderssByMonth,
  validateEmail,
  sendEmail,
  daysDiff,
  getUserSignupsByMonth,
  convertTempletObj,
  folderExists,
  downloadAndExtractFile,
  mergeVariables,
  replaceVariables,
  rzCapturePayment,
  makeRequest,
};
