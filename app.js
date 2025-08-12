require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const fileUpload = require("express-fileupload");
const { initializeSocket } = require("./socket.js");
const path = require("path");
const { init, cleanup } = require("./middlewares/req.js");
const nodeCleanup = require("node-cleanup");

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.json());
app.use(fileUpload());

// routers
const adminRoute = require("./routes/admin");
app.use("/api/admin", adminRoute);

const userRoute = require("./routes/user");
app.use("/api/user", userRoute);

const webRoute = require("./routes/web");
app.use("/api/web", webRoute);

const sessionRoute = require("./routes/session");
app.use("/api/session", sessionRoute);

const inboxRoute = require("./routes/inbox");
app.use("/api/inbox", inboxRoute);

const flowRoute = require("./routes/flow");
app.use("/api/flow", flowRoute);

const chatbotRoute = require("./routes/chatbot");
app.use("/api/chatbot", chatbotRoute);

const templetRoute = require("./routes/templet");
app.use("/api/templet", templetRoute);

const broadcastRoute = require("./routes/broadcast");
app.use("/api/broadcast", broadcastRoute);

const planRoute = require("./routes/plan");
app.use("/api/plan", planRoute);

const apiRoute = require("./routes/api");
const { warmerLoopInit } = require("./loops/warmerLoop.js");
const { broadcastLoopInit } = require("./loops/broadcastLoop.js");
app.use("/api/v1", apiRoute);

app.use(express.static(path.resolve(__dirname, "./client/public")));

app.get("*", function (request, response) {
  response.sendFile(path.resolve(__dirname, "./client/public", "index.html"));
});

const server = app.listen(process.env.PORT || 3010, () => {
  init();
  setTimeout(() => {
    broadcastLoopInit();
    warmerLoopInit();
  }, 2000);
  console.log(`Whatsham server is runnin gon port ${process.env.PORT}`);
});

// Initialize Socket.IO and export it
const io = initializeSocket(server);

module.exports = io;

nodeCleanup(cleanup);
