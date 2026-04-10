import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import OpenAI from "openai"
import admin from "firebase-admin"
import rateLimit from "express-rate-limit"
import Stripe from "stripe"

dotenv.config()

/* ================================
BOOT
================================ */

const app = express()

/* ================================
CORS
================================ */

const allowedOrigins = [
  process.env.FRONTEND_BASE_URL,
  "https://logomakergermany-f2312.web.app",
  "https://logomakergermany-f2312.firebaseapp.com",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
].filter(Boolean)

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)
    if (allowedOrigins.includes(origin)) return cb(null, true)
    return cb(new Error("Not allowed by CORS"))
  },
  credentials: true
}))

/* ================================
STRIPE WEBHOOK (RAW BODY)
================================ */

app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) return res.status(200).send("Stripe not configured")

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20"
    })

    const sig = req.headers["stripe-signature"]
    const secret = process.env.STRIPE_WEBHOOK_SECRET

    if (!sig || !secret) return res.status(400).send("Missing webhook secret/signature")

    const event = stripe.webhooks.constructEvent(req.body, sig, secret)

    return res.json({ received: true, type: event.type })

  } catch (e) {
    console.error("Webhook error:", e?.message || e)
    return res.status(400).send("Webhook error")
  }
})

app.use(express.json({ limit: "2mb" }))

/* ================================
RATE LIMIT
================================ */

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20
})

app.use("/api/", limiter)

/* ================================
FIREBASE (OPTIONAL!)
================================ */

let db = null

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      })

      db = admin.firestore()

      console.log("Firebase Admin initialized")
    }
  } catch (e) {
    console.error("Firebase Admin init failed:", e?.message || e)
  }
} else {
  console.log("Firebase disabled (no service account)")
}

/* ================================
OPENAI
================================ */

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null

/* ================================
AUTH
================================ */

async function requireAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || ""
    const m = hdr.match(/^Bearer (.+)$/)

    if (!m) return res.status(401).json({ error: "Missing token" })
    if (!admin.apps.length) return res.status(500).json({ error: "Firebase not initialized" })

    const decoded = await admin.auth().verifyIdToken(m[1])
    req.user = decoded

    return next()
  } catch {
    return res.status(401).json({ error: "Invalid token" })
  }
}

/* ================================
HEALTH
================================ */

app.get("/", (req, res) => {
  res.status(200).send("OK")
})

/* ================================
TEST ROUTE (wichtig!)
================================ */

app.get("/api/test", (req, res) => {
  res.json({
    status: "running",
    firebase: !!db,
    openai: !!openai
  })
})

/* ================================
START
================================ */

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log("Backend running on port", PORT)
})
