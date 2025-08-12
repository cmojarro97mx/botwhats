const router = require('express').Router()
const { query } = require('../database/dbpromise.js')
const bcrypt = require('bcrypt')
const { sign } = require('jsonwebtoken')
const validateUser = require('../middlewares/user.js')
const moment = require('moment')
const { isValidEmail, encodeObject, readJSONFile, getFileExtension, areMobileNumbersFilled } = require('../functions/function.js')
const randomstring = require('randomstring')
const { getSession, } = require('../middlewares/req.js')
const csv = require('csv-parser');
const mime = require('mime-types')
const { checkPlanExpiry } = require('../middlewares/planValidator.js')

// adding new broadcast 
router.post('/add_broadcast', validateUser, checkPlanExpiry, async (req, res) => {
    try {
        const { title, templet, phonebook, schedule, timezone, instance_id, delay_from, delay_to, scheduleTimestamp } = req.body

        if (!title || !templet || !phonebook || instance_id.length < 1) {
            return res.json({
                msg: "Please fill all the required fields"
            })
        }

        if (schedule && !timezone || !scheduleTimestamp) {
            return res.json({ msg: "Opss... you forgot to set the timezone and timestamp" })
        }

        const { phonebook_id } = phonebook

        if (!phonebook_id) {
            return res.json({ msg: "Invalid phonebook provided" })
        }


        const getPhonebookContacts = await query(`SELECT * FROM contact where phonebook_id = ? AND uid = ?`, [phonebook_id, req.decode.uid])

        if (getPhonebookContacts.length < 1) {
            return res.json({ success: false, msg: "The phonebook you have selected does not have any mobile number in it" })
        }

        const broadcast_id = randomstring.generate(5)

        const broadcast_logs = getPhonebookContacts.map((i) => [
            req.decode.uid,
            broadcast_id,
            templet?.title || "NA",
            i?.mobile,
            "PENDING",
            JSON.stringify(i)
        ])

        await query(`
        INSERT INTO broadcast_log (
            uid,
            broadcast_id,
            templet_name,
            send_to,
            delivery_status,
            contact
        ) VALUES ?`, [broadcast_logs])

        await query(`
                    INSERT INTO broadcast (
                        broadcast_id,
                        uid,
                        title,
                        templet,
                        phonebook,
                        status,
                        schedule,
                        timezone,
                        instance_id,
                        delay_from,
                        delay_to
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
            broadcast_id,
            req.decode.uid,
            title,
            JSON.stringify(templet),
            JSON.stringify(phonebook),
            "PENDING",
            schedule ? new Date(scheduleTimestamp) : new Date(Date.now()),
            timezone || "Asia/Kolkata",
            JSON.stringify(instance_id),
            delay_from,
            delay_to
        ])

        res.json({ success: true, msg: "Your broadcast has been added" })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// get all broadcast 
router.get('/my_broadcast', validateUser, async (req, res) => {
    try {
        const data = await query(`SELECT * FROM broadcast WHERE uid = ?`, [
            req.decode.uid
        ])

        res.json({ data, success: true })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// get broadcast logs 
router.post('/broad_logs', validateUser, async (req, res) => {
    try {
        const { broadcast_id } = req.body

        const data = await query(`SELECT * FROM broadcast_log WHERE broadcast_id = ? AND uid = ?`, [
            broadcast_id,
            req.decode.uid
        ])

        const total = data.length
        const sent = data.filter(i => i.delivery_status === "sent")
        const delivered = data.filter(i => i.delivery_status === "delivered")
        const read = data.filter(i => i.delivery_status === "read")
        const pending = data.filter(i => i.delivery_status === "PENDING")
        const failed = data.filter(i => i.delivery_status === "failed")

        res.json({
            data,
            success: true,
            logDashboard: {
                total,
                sent: sent?.length || 0,
                delivered: delivered?.length || 0,
                read: read?.length || 0,
                pending: pending?.length || 0,
                failed: failed?.length || 0
            }
        })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

// del broadcast 
router.post('/del_broadcast', validateUser, async (req, res) => {
    try {
        const { broadcast_id } = req.body

        await query(`DELETE FROM broadcast WHERE broadcast_id = ? AND uid = ?`, [broadcast_id, req.decode.uid])
        await query(`DELETE FROM broadcast_log WHERE broadcast_id = ?`, [broadcast_id])

        res.json({
            msg: "Broadcast was deleted",
            success: true
        })

    } catch (err) {
        res.json({ success: false, msg: "something went wrong", err })
        console.log(err)
    }
})

module.exports = router