import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import OpenAI from "openai"
import admin from "firebase-admin"
import fs from "fs"
import rateLimit from "express-rate-limit"
import Stripe from "stripe"

dotenv.config()

const app = express()
<<<<<<< HEAD

/* =========================
CORS (locked)
========================= */

const allowedOrigins = [
  process.env.FRONTEND_BASE_URL,
  "http://localhost:5500",
  "http://127.0.0.1:5500"
].filter(Boolean)

app.use(cors({
  origin: (origin, cb) => {
    // allow non-browser tools (no origin)
    if(!origin) return cb(null, true)
    if(allowedOrigins.includes(origin)) return cb(null, true)
    return cb(new Error("Not allowed by CORS"))
  },
  credentials: true
}))
=======
app.use(cors())
>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b

/* =========================
STRIPE
========================= */

const stripeSecret = process.env.STRIPE_SECRET_KEY || ""
const stripe = stripeSecret ? new Stripe(stripeSecret, { apiVersion: "2024-06-20" }) : null
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || ""

function getOrigin(req){
  return FRONTEND_BASE_URL || req.headers.origin || "http://localhost:5500"
}

/* =========================
FIREBASE ADMIN
========================= */

if(!process.env.FIREBASE_SERVICE_ACCOUNT){
  console.error("FIREBASE_SERVICE_ACCOUNT is missing!")
  process.exit(1)
}

let serviceAccount
try{
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
}catch(err){
  console.error("Invalid FIREBASE_SERVICE_ACCOUNT JSON")
  console.error(err)
  process.exit(1)
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
})

const db = admin.firestore()

/* =========================
<<<<<<< HEAD
AUTH MIDDLEWARE
========================= */

async function requireAuth(req, res, next){
  try{
    const hdr = req.headers.authorization || ""
    const m = hdr.match(/^Bearer (.+)$/)
    if(!m) return res.status(401).json({ error: "Missing Authorization Bearer token" })

    const decoded = await admin.auth().verifyIdToken(m[1])
    req.user = decoded
    return next()
  }catch(err){
    return res.status(401).json({ error: "Invalid token" })
  }
}

/* =========================
=======
>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b
OPENAI
========================= */

if(!process.env.OPENAI_API_KEY){
  console.error("OPENAI_API_KEY is missing!")
  process.exit(1)
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/* =====================================================
STRIPE WEBHOOK (RAW BODY!) MUST be BEFORE express.json
===================================================== */

app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try{
    if(!stripe) return res.status(500).send("Stripe not configured")

    const sig = req.headers["stripe-signature"]
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    if(!secret) return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET")

    let event
    try{
      event = stripe.webhooks.constructEvent(req.body, sig, secret)
    }catch(err){
      console.error("Webhook signature verification failed:", err.message)
      return res.status(400).send(`Webhook Error: ${err.message}`)
    }

    if(event.type === "checkout.session.completed"){
      const session = event.data.object
      const userId = session.metadata?.userId
      const coins = parseInt(session.metadata?.coins || "0", 10)

      if(userId && coins > 0){
        await db.collection("users").doc(userId).set({
          coins: admin.firestore.FieldValue.increment(coins)
        }, { merge: true })
      }
    }

    return res.json({ received: true })
  }catch(err){
    console.error(err)
    return res.status(500).send("Webhook handler failed")
  }
})

/* =========================
JSON BODY (AFTER WEBHOOK)
========================= */

app.use(express.json({ limit: "25mb" }))

/* =========================
RATE LIMIT
========================= */

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5
})

// NOTE: Do NOT rate-limit stripe webhook
app.use("/api/generate-logo", limiter)
app.use("/api/generate-30s", limiter)
app.use("/api/logo-from-image", limiter)
app.use("/api/improve-logo", limiter)
app.use("/api/style-dna", limiter)
app.use("/api/create-checkout-session", limiter)

/* =====================================================
HEALTH CHECK
===================================================== */

app.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "LogoMakerGermany Backend",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  })
})

/* =====================================================
COIN PACKS (Frontend display)
===================================================== */

const COIN_PACKS = {
  coins_120:  { coins: 120,  display: "4,99 €",  unit_amount: 499,  name: "120 Coins Paket",  priceId: "price_1T6urn2aeCQNbsN6wCtC5mkGV" },
  coins_300:  { coins: 300,  display: "9,99 €",  unit_amount: 999,  name: "300 Coins Paket",  priceId: "price_1T6utu2aeCQNbsN6suXJWEvX" },
  coins_700:  { coins: 700,  display: "19,99 €", unit_amount: 1999, name: "700 Coins Paket",  priceId: "price_1T6uti2aeCQNbsN6SYJTsmpZ" },
  coins_2000: { coins: 2000, display: "49,90 €", unit_amount: 4990, name: "2000 Coins Paket", priceId: "price_1T6uuJ2aeCQNbsN6hNuF2NmH" }
}

app.get("/api/packs", (req, res) => {
  const out = {}
  for(const [k,v] of Object.entries(COIN_PACKS)){
    out[k] = { coins: v.coins, display: v.display }
  }
  return res.json(out)
})

/* =====================================================
<<<<<<< HEAD
GET USER COINS (secure)
===================================================== */

app.post("/api/get-coins", requireAuth, async (req, res) => {
  try{
    const userId = req.user.uid
    const ref = db.collection("users").doc(userId)
    const snap = await ref.get()

    if(!snap.exists){
      await ref.set({ uid: userId, coins: 0, premiumUntil: 0, createdAt: Date.now() }, { merge: true })
      return res.json({ coins: 0, premiumUntil: 0 })
    }

    const data = snap.data() || {}
    return res.json({
      coins: data.coins || 0,
      premiumUntil: data.premiumUntil || 0
    })
  }catch(err){
    console.error(err)
    return res.status(500).json({ error: "Failed to load coins" })
  }
})

/* =====================================================
COIN PURCHASE (STRIPE CHECKOUT)
===================================================== */

app.post("/api/create-checkout-session", requireAuth, async (req, res) => {
  try{
    if(!stripe) return res.status(500).json({ error: "Stripe not configured" })

    const userId = req.user.uid
    const { packId } = req.body
    if(!packId) return res.status(400).json({ error: "Missing data" })
=======
COIN PURCHASE (STRIPE CHECKOUT)
===================================================== */

app.post("/api/create-checkout-session", async (req, res) => {
  try{
    if(!stripe) return res.status(500).json({ error: "Stripe not configured" })

    const { userId, packId } = req.body
    if(!userId || !packId) return res.status(400).json({ error: "Missing data" })
>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b

    const pack = COIN_PACKS[packId]
    if(!pack) return res.status(400).json({ error: "Unknown pack" })

<<<<<<< HEAD
    // Optional: ensure user doc exists (create minimal doc if missing)
    const userRef = db.collection("users").doc(userId)
    const userDoc = await userRef.get()
    if(!userDoc.exists){
      await userRef.set({
        uid: userId,
        coins: 0,
        premiumUntil: 0,
        createdAt: Date.now()
      }, { merge: true })
    }
=======
    const userRef = db.collection("users").doc(userId)
    const userDoc = await userRef.get()
    if(!userDoc.exists) return res.status(404).json({ error: "User not found" })
>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b

    const origin = getOrigin(req)

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: pack.priceId
        ? [{ price: pack.priceId, quantity: 1 }]
        : [{
            price_data: {
              currency: "eur",
              product_data: { name: pack.name },
              unit_amount: pack.unit_amount
            },
            quantity: 1
          }],
      metadata: {
        userId,
        coins: String(pack.coins),
        packId
      },
      success_url: origin + "/?checkout=success",
      cancel_url: origin + "/?checkout=cancel"
    })

    return res.json({ url: session.url })
  }catch(err){
    console.error(err)
    return res.status(500).json({ error: "Checkout session failed" })
  }
})

/* =====================================================
SINGLE LOGO GENERATION
===================================================== */

<<<<<<< HEAD
app.post("/api/generate-logo", requireAuth, async (req, res) => {
  try{
    const { prompt, renderMode } = req.body
    const userId = req.user.uid
    if(!prompt || !renderMode)
=======
app.post("/api/generate-logo", async (req, res) => {
  try{
    const { prompt, renderMode, userId } = req.body
    if(!prompt || !renderMode || !userId)
>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b
      return res.status(400).json({ error: "Missing data" })

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
<<<<<<< HEAD

    // ✅ ATOMIC coin check + deduct (prevents multi-request exploit)
    let newCoins = 0
    await db.runTransaction(async (t) => {
      const snap = await t.get(userRef)
      if(!snap.exists) throw new Error("USER_NOT_FOUND")

      const userData = snap.data() || {}
      const currentCoins = userData.coins || 0
      const premiumUntil = userData.premiumUntil || 0
      const isPremium = premiumUntil > Date.now()

      if(renderMode === "master_overkill" && !isPremium)
        throw new Error("PREMIUM_REQUIRED")

      if(isPremium) cost = Math.floor(cost * 0.9)

      if(currentCoins < cost)
        throw new Error("NOT_ENOUGH_COINS")

      newCoins = currentCoins - cost
      t.update(userRef, { coins: newCoins })
    })
=======
    const userDoc = await userRef.get()
    if(!userDoc.exists) return res.status(404).json({ error: "User not found" })

    const userData = userDoc.data() || {}
    const currentCoins = userData.coins || 0
    const premiumUntil = userData.premiumUntil || 0
    const isPremium = premiumUntil > Date.now()

    if(renderMode === "master_overkill" && !isPremium)
      return res.status(403).json({ error: "Master Overkill requires Premium." })

    if(isPremium) cost = Math.floor(cost * 0.9)

    if(currentCoins < cost)
      return res.status(403).json({ error: "Not enough coins" })
>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b

    const result = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      background: "transparent"
    })

    const imageBase64 = result.data[0].b64_json

<<<<<<< HEAD
    return res.json({
      image: `data:image/png;base64,${imageBase64}`,
      newCoins
    })
  }catch(err){
    if(err.message === "USER_NOT_FOUND") return res.status(404).json({ error: "User not found" })
    if(err.message === "PREMIUM_REQUIRED") return res.status(403).json({ error: "Master Overkill requires Premium." })
    if(err.message === "NOT_ENOUGH_COINS") return res.status(403).json({ error: "Not enough coins" })
=======
    await userRef.update({ coins: currentCoins - cost })

    return res.json({
      image: `data:image/png;base64,${imageBase64}`,
      newCoins: currentCoins - cost
    })
  }catch(err){
>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b
    console.error(err)
    return res.status(500).json({ error: "Image generation failed" })
  }
})

/* =====================================================
STYLE DNA (analyze uploaded image -> reusable prompt)
===================================================== */

<<<<<<< HEAD
app.post("/api/style-dna", requireAuth, async (req, res) => {
  try{
    const { imageDataUrl } = req.body
    const userId = req.user.uid
    if(!imageDataUrl)
      return res.status(400).json({ error: "Missing data" })

    // ensure user exists
=======
app.post("/api/style-dna", async (req, res) => {
  try{
    const { imageDataUrl, userId } = req.body
    if(!imageDataUrl || !userId)
      return res.status(400).json({ error: "Missing data" })

>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b
    const userRef = db.collection("users").doc(userId)
    const userDoc = await userRef.get()
    if(!userDoc.exists) return res.status(404).json({ error: "User not found" })

    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Analyze this image style and output JSON with keys: styleDNA (one short line to append to prompts), palette (array of up to 5 hex colors if you can infer), vibeTags (array of up to 8 short tags). Keep styleDNA under 200 characters. Output JSON only."
            },
            { type: "input_image", image_url: imageDataUrl, detail: "auto" }
          ]
        }
      ]
    })

    const txt = resp.output_text || "{}"
    let json
    try{
      json = JSON.parse(txt)
    }catch{
      json = { styleDNA: String(txt).slice(0, 200), palette: [], vibeTags: [] }
    }

    return res.json({
      styleDNA: (json.styleDNA || "").slice(0, 200),
      palette: Array.isArray(json.palette) ? json.palette.slice(0, 5) : [],
      vibeTags: Array.isArray(json.vibeTags) ? json.vibeTags.slice(0, 8) : []
    })
  }catch(err){
    console.error(err)
    return res.status(500).json({ error: "Style analysis failed" })
  }
})

/* =====================================================
SELFIE -> LOGO (image edit)
===================================================== */

<<<<<<< HEAD
app.post("/api/logo-from-image", requireAuth, async (req, res) => {
  try{
    const { imageDataUrl, name, renderMode, styleDNA } = req.body
    const userId = req.user.uid
    if(!imageDataUrl || !name || !renderMode)
=======
app.post("/api/logo-from-image", async (req, res) => {
  try{
    const { imageDataUrl, name, renderMode, userId, styleDNA } = req.body
    if(!imageDataUrl || !name || !renderMode || !userId)
>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b
      return res.status(400).json({ error: "Missing data" })

    const renderCosts = {
      "2d": 8,
      "3d": 12,
      "realistic": 25,
      "overkill": 40,
      "ultra_overkill": 60,
      "master_overkill": 90
    }

    let cost = renderCosts[renderMode] || 12

    const userRef = db.collection("users").doc(userId)
<<<<<<< HEAD

    let newCoins = 0
    await db.runTransaction(async (t) => {
      const snap = await t.get(userRef)
      if(!snap.exists) throw new Error("USER_NOT_FOUND")

      const userData = snap.data() || {}
      const currentCoins = userData.coins || 0
      const premiumUntil = userData.premiumUntil || 0
      const isPremium = premiumUntil > Date.now()

      if(renderMode === "master_overkill" && !isPremium)
        throw new Error("PREMIUM_REQUIRED")

      if(isPremium) cost = Math.floor(cost * 0.9)

      if(currentCoins < cost)
        throw new Error("NOT_ENOUGH_COINS")

      newCoins = currentCoins - cost
      t.update(userRef, { coins: newCoins })
    })
=======
    const userDoc = await userRef.get()
    if(!userDoc.exists) return res.status(404).json({ error: "User not found" })

    const userData = userDoc.data() || {}
    const currentCoins = userData.coins || 0
    const premiumUntil = userData.premiumUntil || 0
    const isPremium = premiumUntil > Date.now()

    if(renderMode === "master_overkill" && !isPremium)
      return res.status(403).json({ error: "Master Overkill requires Premium." })

    if(isPremium) cost = Math.floor(cost * 0.9)

    if(currentCoins < cost)
      return res.status(403).json({ error: "Not enough coins" })
>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b

    const prompt = `
Create a professional esports gaming logo from the uploaded selfie.
Keep it recognizable but stylize into a clean mascot/emblem design.
Centered bust/face silhouette, bold outlines, high contrast.
Add the text '${name}' cleanly.
${styleDNA ? "Style DNA: " + styleDNA : ""}
Transparent background.
`

    const result = await openai.images.edit({
      model: "gpt-image-1",
      images: [{ image_url: imageDataUrl }],
      prompt,
      background: "transparent",
      input_fidelity: "low",
      size: "1024x1024"
    })

    const imageBase64 = result.data?.[0]?.b64_json
    if(!imageBase64) return res.status(500).json({ error: "No image returned" })

<<<<<<< HEAD
    return res.json({
      image: `data:image/png;base64,${imageBase64}`,
      newCoins
    })
  }catch(err){
    if(err.message === "USER_NOT_FOUND") return res.status(404).json({ error: "User not found" })
    if(err.message === "PREMIUM_REQUIRED") return res.status(403).json({ error: "Master Overkill requires Premium." })
    if(err.message === "NOT_ENOUGH_COINS") return res.status(403).json({ error: "Not enough coins" })
=======
    await userRef.update({ coins: currentCoins - cost })

    return res.json({
      image: `data:image/png;base64,${imageBase64}`,
      newCoins: currentCoins - cost
    })
  }catch(err){
>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b
    console.error(err)
    return res.status(500).json({ error: "Selfie logo generation failed" })
  }
})

/* =====================================================
IMPROVE EXISTING LOGO (image edit)
===================================================== */

<<<<<<< HEAD
app.post("/api/improve-logo", requireAuth, async (req, res) => {
  try{
    const { imageDataUrl, renderMode, notes } = req.body
    const userId = req.user.uid
    if(!imageDataUrl || !renderMode)
=======
app.post("/api/improve-logo", async (req, res) => {
  try{
    const { imageDataUrl, renderMode, userId, notes } = req.body
    if(!imageDataUrl || !renderMode || !userId)
>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b
      return res.status(400).json({ error: "Missing data" })

    const renderCosts = {
      "2d": 6,
      "3d": 10,
      "realistic": 20,
      "overkill": 30,
      "ultra_overkill": 45,
      "master_overkill": 70
    }

    let cost = renderCosts[renderMode] || 10

    const userRef = db.collection("users").doc(userId)
<<<<<<< HEAD

    let newCoins = 0
    await db.runTransaction(async (t) => {
      const snap = await t.get(userRef)
      if(!snap.exists) throw new Error("USER_NOT_FOUND")

      const userData = snap.data() || {}
      const currentCoins = userData.coins || 0
      const premiumUntil = userData.premiumUntil || 0
      const isPremium = premiumUntil > Date.now()

      if(renderMode === "master_overkill" && !isPremium)
        throw new Error("PREMIUM_REQUIRED")

      if(isPremium) cost = Math.floor(cost * 0.9)

      if(currentCoins < cost)
        throw new Error("NOT_ENOUGH_COINS")

      newCoins = currentCoins - cost
      t.update(userRef, { coins: newCoins })
    })
=======
    const userDoc = await userRef.get()
    if(!userDoc.exists) return res.status(404).json({ error: "User not found" })

    const userData = userDoc.data() || {}
    const currentCoins = userData.coins || 0
    const premiumUntil = userData.premiumUntil || 0
    const isPremium = premiumUntil > Date.now()

    if(renderMode === "master_overkill" && !isPremium)
      return res.status(403).json({ error: "Master Overkill requires Premium." })

    if(isPremium) cost = Math.floor(cost * 0.9)

    if(currentCoins < cost)
      return res.status(403).json({ error: "Not enough coins" })
>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b

    const prompt = `
Improve this logo to next level while keeping the same identity.
Keep composition and core shapes recognizable.
Make it cleaner, sharper, higher contrast, better typography, remove artifacts.
Enhance edges, symmetry, and professional esports finish.
${notes ? "User notes: " + notes : ""}
Transparent background.
`

    const result = await openai.images.edit({
      model: "gpt-image-1",
      images: [{ image_url: imageDataUrl }],
      prompt,
      background: "transparent",
      input_fidelity: "high",
      size: "1024x1024"
    })

    const imageBase64 = result.data?.[0]?.b64_json
    if(!imageBase64) return res.status(500).json({ error: "No image returned" })

<<<<<<< HEAD
    return res.json({
      image: `data:image/png;base64,${imageBase64}`,
      newCoins
    })
  }catch(err){
    if(err.message === "USER_NOT_FOUND") return res.status(404).json({ error: "User not found" })
    if(err.message === "PREMIUM_REQUIRED") return res.status(403).json({ error: "Master Overkill requires Premium." })
    if(err.message === "NOT_ENOUGH_COINS") return res.status(403).json({ error: "Not enough coins" })
=======
    await userRef.update({ coins: currentCoins - cost })

    return res.json({
      image: `data:image/png;base64,${imageBase64}`,
      newCoins: currentCoins - cost
    })
  }catch(err){
>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b
    console.error(err)
    return res.status(500).json({ error: "Logo improvement failed" })
  }
})

/* =====================================================
30S FULL PACK GENERATION
===================================================== */

<<<<<<< HEAD
app.post("/api/generate-30s", requireAuth, async (req, res) => {
  try{
    const { platform, renderMode } = req.body
    const userId = req.user.uid
    if(!platform || !renderMode)
=======
app.post("/api/generate-30s", async (req, res) => {
  try{
    const { platform, renderMode, userId } = req.body
    if(!platform || !renderMode || !userId)
>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b
      return res.status(400).json({ error: "Missing data" })

    const userRef = db.collection("users").doc(userId)
    const userDoc = await userRef.get()
    if(!userDoc.exists) return res.status(404).json({ error: "User not found" })

    const userData = userDoc.data() || {}
<<<<<<< HEAD
=======
    const currentCoins = userData.coins || 0
>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b
    const premiumUntil = userData.premiumUntil || 0
    const isPremium = premiumUntil > Date.now()

    const master = JSON.parse(fs.readFileSync("./platformMaster.json", "utf8"))
    if(!master[platform]) return res.status(400).json({ error: "Platform not supported" })

    const assets = master[platform].assets
    let cost = assets.length * 8
    if(isPremium) cost = Math.floor(cost * 0.8)

<<<<<<< HEAD
    // ✅ atomic charge
    let newCoins = 0
    await db.runTransaction(async (t) => {
      const snap = await t.get(userRef)
      if(!snap.exists) throw new Error("USER_NOT_FOUND")
      const d = snap.data() || {}
      const currentCoins = d.coins || 0
      if(currentCoins < cost) throw new Error("NOT_ENOUGH_COINS")
      newCoins = currentCoins - cost
      t.update(userRef, { coins: newCoins })
    })
=======
    if(currentCoins < cost)
      return res.status(403).json({ error: "Not enough coins for 30s Pack" })
>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b

    const generated = []

    for(const asset of assets){
      const result = await openai.images.generate({
        model: "gpt-image-1",
        prompt: asset.prompt,
        size: asset.size || "1024x1024",
        background: "transparent"
      })

      generated.push({
        name: asset.name + ".png",
        image: `data:image/png;base64,${result.data[0].b64_json}`
      })
    }

<<<<<<< HEAD
    return res.json({
      files: generated,
      newCoins
    })
  }catch(err){
    if(err.message === "USER_NOT_FOUND") return res.status(404).json({ error: "User not found" })
    if(err.message === "NOT_ENOUGH_COINS") return res.status(403).json({ error: "Not enough coins for 30s Pack" })
=======
    await userRef.update({ coins: currentCoins - cost })

    return res.json({
      files: generated,
      newCoins: currentCoins - cost
    })
  }catch(err){
>>>>>>> 4adc12489b716fc864c574220ff523bd9a79177b
    console.error(err)
    return res.status(500).json({ error: "30s generation failed" })
  }
})

/* =====================================================
START SERVER
===================================================== */

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`)
})