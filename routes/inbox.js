const router = require('express').Router()
const { query } = require('../database/dbpromise.js')
const bcrypt = require('bcrypt')
const { sign } = require('jsonwebtoken')
const validateUser = require('../middlewares/user.js')
const moment = require('moment')
const { isValidEmail, encodeObject, sendChatTextMessage, deleteFileIfExists, getImageAsBase64, convertTempletObj } = require('../functions/function.js')
const randomstring = require('randomstring')
const { createSession, sendMessage, getSession, formatPhone, getChatList } = require('../middlewares/req.js')
const { fetchPersonStatus, fetchProfileUrl, fetchBusinessprofile, fetchGroupMeta } = require('../functions/control.js')
const { sendTextMsg, sendMedia, sendPollMsg } = require('../functions/x.js')
const mime = require('mime-types');
const { checkPlanExpiry } = require('../middlewares/planValidator.js')

// get my chats 
router.get("/get_my_chats", validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const { instance } = req.query

        let selIns

        if (instance) {

            selIns = instance

            await query(`UPDATE user SET opened_chat_instance = ? WHERE uid = ?`, [
                instance,
                req.decode.uid
            ])
        } else {

            // getting already selected instance 
            if (req?.user?.opened_chat_instance) {
                selIns = req?.user?.opened_chat_instance
            } else {

                // setting the instance 
                const getInstance = await query(`SELECT * FROM instance WHERE uid = ? LIMIT 1`, [
                    req.decode.uid
                ])

                const selInsId = getInstance[0]?.instance_id
                selIns = selInsId

                await query(`UPDATE user SET opened_chat_instance = ? WHERE uid = ?`, [
                    selInsId,
                    req.decode.uid
                ])
            }
        }

        // testing the instance 
        const session = await getSession(selIns)

        if (!session) {
            return res.json({ msg: "Instance not found. Please re add the instance" })
        }

        const userData = session?.authState?.creds?.me || session.user

        const data = await query(`SELECT * FROM chats WHERE uid = ? AND instance_id = ?`, [
            req.decode.uid,
            selIns
        ])
        res.json({ data, success: true, userData: { ...userData, selIns } })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})


// send text message 
router.post('/send_text', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const { text, toJid, toName, chatId, instance } = req.body

        if (!text || !toJid || !toName || !chatId || !instance) {
            return res.json({ success: false, msg: "Not enough input provided" })
        }

        const msgObj = {
            text
        }

        const uid = req.decode.uid

        const saveObj = {
            "group": false,
            "type": "text",
            "msgId": "",
            "remoteJid": toJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": toName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        }

        const session = await getSession(instance)

        const resp = await sendTextMsg({
            uid,
            msgObj,
            toJid,
            saveObj,
            chatId,
            session,
            sessionId: instance
        })

        res.json(resp)

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// send image msg 
router.post('/send_image', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const { caption, toJid, toName, chatId, instance, fileName, image } = req.body


        if (!toJid || !toName || !chatId || !instance || !fileName || !image) {
            return res.json({ success: false, msg: "Please select an image" })
        }

        const sendObj = {
            image: {
                url: `${__dirname}/../client/public/media/${image}`
            },
            caption: caption || null,
            fileName,
            jpegThumbnail: getImageAsBase64(`${__dirname}/../client/public/media/${image}`)
        }

        const msgObj = {
            caption: caption || "",
            fileName: image,
            "mimetype": mime.lookup(image)
        }

        const uid = req.decode.uid

        const saveObj = {
            "group": false,
            "type": "image",
            "msgId": "",
            "remoteJid": toJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": toName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        }

        const session = await getSession(instance)

        const resp = await sendMedia({
            uid,
            msgObj,
            toJid,
            saveObj,
            chatId,
            session,
            sessionId: instance,
            sendObj
        })

        res.json(resp)

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})


// send video 
router.post('/send_video', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const { caption, toJid, toName, chatId, instance, fileName, originalFile } = req.body

        if (!toJid || !toName || !chatId || !instance || !fileName || !originalFile) {
            return res.json({ success: false, msg: "Please select an video" })
        }

        const sendObj = {
            video: {
                url: `${__dirname}/../client/public/media/${fileName}`
            },
            caption: caption || null,
            fileName: originalFile
        }

        const msgObj = {
            caption: caption || "",
            fileName: fileName,
            mimetype: mime.lookup(fileName)
        }

        const uid = req.decode.uid

        const saveObj = {
            "group": false,
            "type": "video",
            "msgId": "",
            "remoteJid": toJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": toName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        }

        const session = await getSession(instance)

        console.log({
            sendObj
        })

        const resp = await sendMedia({
            uid,
            msgObj,
            toJid,
            saveObj,
            chatId,
            session,
            sessionId: instance,
            sendObj
        })

        res.json(resp)

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// send doc 
router.post('/send_doc', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const { caption, toJid, toName, chatId, instance, fileName, originalFile } = req.body

        if (!toJid || !toName || !chatId || !instance || !fileName || !originalFile) {
            return res.json({ success: false, msg: "Please select an video" })
        }

        const sendObj = {
            document: {
                url: `${__dirname}/../client/public/media/${fileName}`
            },
            caption: caption || null,
            fileName: originalFile
        }

        const msgObj = {
            caption: caption || "",
            fileName: fileName,
            mimetype: mime.lookup(fileName)
        }

        const uid = req.decode.uid

        const saveObj = {
            "group": false,
            "type": "doc",
            "msgId": "",
            "remoteJid": toJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": toName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        }

        const session = await getSession(instance)

        const resp = await sendMedia({
            uid,
            msgObj,
            toJid,
            saveObj,
            chatId,
            session,
            sessionId: instance,
            sendObj
        })

        res.json(resp)

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// send audio 
router.post('/send_aud', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const { toJid, toName, chatId, instance, fileName, originalFile } = req.body

        if (!toJid || !toName || !chatId || !instance || !fileName || !originalFile) {
            return res.json({ success: false, msg: "Please select an video" })
        }

        const sendObj = {
            audio: {
                url: `${__dirname}/../client/public/media/${fileName}`
            },
            fileName: originalFile,
            ptt: true
        }

        const msgObj = {
            caption: "",
            fileName: fileName,
            mimetype: mime.lookup(fileName)
        }

        const uid = req.decode.uid

        const saveObj = {
            "group": false,
            "type": "aud",
            "msgId": "",
            "remoteJid": toJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": toName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        }

        const session = await getSession(instance)

        const resp = await sendMedia({
            uid,
            msgObj,
            toJid,
            saveObj,
            chatId,
            session,
            sessionId: instance,
            sendObj
        })

        res.json(resp)

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// send location 
router.post('/send_loc', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const { toJid, toName, chatId, instance, lat, long } = req.body

        if (!toJid || !toName || !chatId || !instance || !lat || !long) {
            return res.json({ success: false, msg: "Please write all fields" })
        }

        const sendObj = {
            location: { degreesLatitude: lat, degreesLongitude: long }
        }

        const msgObj = {
            lat: lat,
            long: long,
            "name": "",
            "address": ""
        }

        const uid = req.decode.uid

        const saveObj = {
            "group": false,
            "type": "loc",
            "msgId": "",
            "remoteJid": toJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": toName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        }

        const session = await getSession(instance)

        const resp = await sendMedia({
            uid,
            msgObj,
            toJid,
            saveObj,
            chatId,
            session,
            sessionId: instance,
            sendObj
        })

        res.json(resp)

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})


// send poll message 
router.post('/send_poll', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const { toJid, toName, chatId, instance, name, values } = req.body

        if (!toJid || !toName || !chatId || !instance) {
            return res.json({ success: false, msg: "Invalid request" })
        }

        if (!name || values?.length < 1) {
            return res.json({ msg: "Please give a poll title and poll option(s)" })
        }

        if (values.length < 2) {
            return res.json({ msg: "At least 2 options are reuired" })
        }

        const msgObj = {
            poll: {
                name: name?.slice(0, 230),
                values: values,
                selectableCount: 1
            }
        }

        const uid = req.decode.uid

        const saveObj = {
            "group": false,
            "type": "poll",
            "msgId": "",
            "remoteJid": toJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": toName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        }

        const session = await getSession(instance)


        const resp = await sendTextMsg({
            uid,
            msgObj,
            toJid,
            saveObj,
            chatId,
            session,
            sessionId: instance,
        })

        res.json(resp)

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})


// del chat 
router.post('/del_chat', validateUser, async (req, res) => {
    try {
        const { chatId } = req.body

        if (!chatId) {
            return res.json({ msg: "Please provide chat id" })
        }

        await query(`DELETE FROM chats WHERE chat_id = ?`, [
            chatId
        ])

        const filePath = `${__dirname}/../conversations/inbox/${req.decode.uid}/${chatId}.json`
        deleteFileIfExists(filePath)

        res.json({
            msg: "Chat was deleted",
            success: true
        })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// getting sender details 
router.post('/get_sender_details', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const { sessionId, jid } = req.body

        if (!sessionId || !jid) {
            return res.json({
                msg: "Invalid request"
            })
        }

        const session = await getSession(sessionId)

        if (!session) {
            return res.json({
                msg: "This session is busy could not fetch the details"
            })
        }

        const status = await fetchPersonStatus(session, jid)
        const profilePhoto = await fetchProfileUrl(session, jid)
        // const pro = await fetchBusinessprofile(session, jid)

        res.json({
            success: true,
            status: status,
            profilePhoto: profilePhoto,
            // pro: pro
        })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// get group meta data info 
router.post('/get_group_meta', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const { sessionId, jid } = req.body

        if (!sessionId || !jid) {
            return res.json({
                msg: "Invalid request"
            })
        }

        const session = await getSession(sessionId)

        if (!session) {
            return res.json({
                msg: "This session is busy could not fetch the details"
            })
        }

        const groupData = await fetchGroupMeta(session, jid)
        const profilePhoto = await fetchProfileUrl(session, jid)

        res.json({
            success: true, profilePhoto, groupData
        })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// get chat note 
router.post("/get_chat_note", validateUser, async (req, res) => {
    try {
        const getChat = await query(`SELECT * FROM chats WHERE chat_id = ? AND uid = ?`, [
            req.body.chatId,
            req.decode.uid
        ])

        res.json({
            success: true,
            data: getChat[0]?.chat_note || ""
        })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// get chat note 
router.post('/update_chat_note', validateUser, async (req, res) => {
    try {
        const { chatId, note } = req.body
        await query(`UPDATE chats SET chat_note = ? WHERE chat_id = ? AND uid = ?`, [
            note,
            chatId,
            req.decode.uid
        ])

        res.json({
            success: true,
            msg: "Note updated"
        })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// get msg Votes 
router.post('/get_poll_votes', validateUser, async (req, res) => {
    try {
        const { msgId } = req.body
        const data = await query(`SELECT * FROM poll_votes WHERE msg_id = ? AND uid = ?`, [
            msgId,
            req.decode.uid
        ])

        res.json({
            data,
            success: true
        })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// send templet 
router.post('/send_templet', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const { id, toJid, toName, chatId, instance } = req.body


        if (!toJid || !toName || !chatId || !instance) {
            return res.json({ success: false, msg: "Not enough input provided" })
        }

        const getTemplet = await query(`SELECT * FROM templet WHERE id = ? AND uid = ?`, [id, req.decode.uid])

        if (getTemplet.length < 1) {
            return res.json({ msg: "Templet not found" })
        }

        const templetContet = JSON.parse(getTemplet[0]?.content)
        const templetType = getTemplet[0]?.type


        // const msgObj = templetContet
        const { sendObj, msgObj, type } = await convertTempletObj(templetContet, templetType)


        console.log({
            type,
            sendObj
        })

        const uid = req.decode.uid

        const saveObj = {
            "group": false,
            "type": templetType?.toLowerCase(),
            "msgId": "",
            "remoteJid": toJid,
            "msgContext": msgObj,
            "reaction": "",
            "timestamp": "",
            "senderName": toName,
            "status": "sent",
            "star": false,
            "route": "outgoing",
            "context": ""
        }

        const session = await getSession(instance)

        if (templetType === "text" || templetType === "poll" || templetType === "loc") {
            const resp = await sendTextMsg({
                uid,
                msgObj,
                toJid,
                saveObj,
                chatId,
                session,
                sessionId: instance
            })
            res.json(resp)
        } else {

            const resp = await sendMedia({
                uid,
                msgObj,
                toJid,
                saveObj,
                chatId,
                session,
                sessionId: instance,
                sendObj
            })
            res.json(resp)
        }


    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

module.exports = router