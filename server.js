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
CORS (locked)
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
    if (!origin) return cb(null, true) // allow tools without origin
    if (allowedOrigins.includes(origin)) return cb(null, true)
    return cb(new Error("Not allowed by CORS"))
  },
  credentials: true
}))

/* ================================
BODY PARSERS
Stripe webhook needs RAW body
================================ */

app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) return res.status(200).send("Stripe not configured")
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" })

    const sig = req.headers["stripe-signature"]
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    if (!sig || !secret) return res.status(400).send("Missing webhook secret/signature")

    const event = stripe.webhooks.constructEvent(req.body, sig, secret)

    // TODO: credit coins after successful checkout (checkout.session.completed)
    // Keep it safe: always verify metadata userId etc.
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
FIREBASE ADMIN
================================ */

function loadServiceAccountFromEnv() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT")
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT JSON")
  }
}

try {
  if (!admin.apps.length) {
    const serviceAccount = loadServiceAccountFromEnv()
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    })
  }
} catch (e) {
  console.error("Firebase Admin init failed:", e?.message || e)
}

const db = admin.apps.length ? admin.firestore() : null

/* ================================
OPENAI
================================ */

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

/* ================================
AUTH MIDDLEWARE
================================ */

async function requireAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || ""
    const m = hdr.match(/^Bearer (.+)$/)
    if (!m) return res.status(401).json({ error: "Missing Authorization Bearer token" })
    if (!admin.apps.length) return res.status(500).json({ error: "Firebase Admin not initialized" })

    const decoded = await admin.auth().verifyIdToken(m[1])
    req.user = decoded
    return next()
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" })
  }
}

/* ================================
HELPER: DAY KEY (UTC)
================================ */

function dayKeyUTC() {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const da = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${da}`
}

/* ================================
HEALTH
================================ */

app.get("/", (req, res) => {
  res.status(200).send("OK")
})

/* ================================
COINS
================================ */

app.get("/api/get-coins", requireAuth, async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "DB not ready" })
    const userId = req.user.uid
    const ref = db.collection("users").doc(userId)
    const snap = await ref.get()
    if (!snap.exists) return res.json({ coins: 0 })
    const data = snap.data() || {}
    return res.json({ coins: data.coins || 0 })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: "Failed to load coins" })
  }
})

/* ================================
GENERATE LOGO (atomic coins)
================================ */

app.post("/api/generate-logo", requireAuth, async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "DB not ready" })
    if (!openai) return res.status(500).json({ error: "OpenAI not configured" })

    const { prompt, renderMode } = req.body || {}
    if (!prompt || !renderMode) return res.status(400).json({ error: "Missing prompt/renderMode" })

    const userId = req.user.uid

    const renderCosts = {
      "2d": 5,
      "3d": 10,
      "realistic": 20,
      "overkill": 35,
      "ultra_overkill": 50,
      "master_overkill": 75
    }

    let cost = renderCosts[renderMode] || 10
    const userRef = db.collection("users").doc(userId)

    let newCoins = 0

    await db.runTransaction(async (t) => {
      const snap = await t.get(userRef)
      if (!snap.exists) throw new Error("USER_NOT_FOUND")

      const data = snap.data() || {}
      const currentCoins = data.coins || 0
      const premiumUntil = data.premiumUntil || 0
      const isPremium = premiumUntil > Date.now()

      if (renderMode === "master_overkill" && !isPremium) throw new Error("PREMIUM_REQUIRED")
      if (isPremium) cost = Math.floor(cost * 0.9)

      if (currentCoins < cost) throw new Error("NOT_ENOUGH_COINS")

      newCoins = currentCoins - cost
      t.update(userRef, { coins: newCoins })
    })

    const result = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      background: "transparent"
    })

    const imageBase64 = result.data?.[0]?.b64_json
    if (!imageBase64) return res.status(500).json({ error: "No image returned" })

    return res.json({
      image: `data:image/png;base64,${imageBase64}`,
      newCoins
    })
  } catch (e) {
    const msg = e?.message || String(e)
    if (msg === "USER_NOT_FOUND") return res.status(404).json({ error: "User not found" })
    if (msg === "PREMIUM_REQUIRED") return res.status(403).json({ error: "Premium required" })
    if (msg === "NOT_ENOUGH_COINS") return res.status(403).json({ error: "Not enough coins" })
    console.error(e)
    return res.status(500).json({ error: "Generation failed" })
  }
})

/* ================================
GENERATE 30s (atomic coins + daily limit)
SAFE TEST MODE (dummy response)
================================ */

app.post("/api/generate-30s", requireAuth, async (req, res) => {
  try {
    if (!db) return res.status(500).json({ error: "DB not ready" })

    const userId = req.user.uid

    // ✅ Safe test setup:
    // - Each 30s run costs 300 coins
    // - Max 2 runs per day per user
    const COST_30S = 300
    const DAILY_LIMIT = 2
    const today = dayKeyUTC()

    const userRef = db.collection("users").doc(userId)

    let newCoins = 0
    let usedToday = 0

    await db.runTransaction(async (t) => {
      const snap = await t.get(userRef)
      if (!snap.exists) throw new Error("USER_NOT_FOUND")

      const data = snap.data() || {}
      const currentCoins = data.coins || 0

      const counters = data.daily30s || {}
      usedToday = counters[today] || 0

      if (usedToday >= DAILY_LIMIT) throw new Error("DAILY_LIMIT_30S")
      if (currentCoins < COST_30S) throw new Error("NOT_ENOUGH_COINS")

      newCoins = currentCoins - COST_30S

      t.update(userRef, {
        coins: newCoins,
        [`daily30s.${today}`]: usedToday + 1
      })
    })

    // ✅ TODO: Replace this with real 30s generation later
    // For now it returns a dummy payload so UI can proceed and you can test coins/limits safely.
    return res.json({
      ok: true,
      message: "30s test run accepted (dummy). Hook real generator next.",
      newCoins,
      dailyUsed: usedToday + 1,
      dailyLimit: DAILY_LIMIT
    })

  } catch (e) {
    const msg = e?.message || String(e)
    if (msg === "USER_NOT_FOUND") return res.status(404).json({ error: "User not found" })
    if (msg === "DAILY_LIMIT_30S") return res.status(429).json({ error: "Daily 30s limit reached" })
    if (msg === "NOT_ENOUGH_COINS") return res.status(403).json({ error: "Not enough coins" })
    console.error(e)
    return res.status(500).json({ error: "30s generation failed" })
  }
})

/* ================================
START
================================ */

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log("Backend running on port", PORT)
})