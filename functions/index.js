const functions = require("@google-cloud/functions-framework");
const { Firestore } = require("@google-cloud/firestore");

const db = new Firestore();
const ALLOWED_ORIGINS = ["https://trackin.gg", "https://www.trackin.gg"];
const RATE_LIMIT = 3; // max submissions per IP per hour

functions.http("waitlist", async (req, res) => {
  const origin = req.headers.origin || "";

  // CORS headers
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Origin check
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Honeypot check — if the hidden field has a value, it's a bot
  if (req.body.website) {
    // Pretend success so bots don't know they were caught
    return res.status(200).json({ success: true });
  }

  const email = (req.body.email || "").trim().toLowerCase();

  if (!email || !email.includes("@") || !email.includes(".")) {
    return res.status(400).json({ error: "Invalid email" });
  }

  // Rate limiting by IP
  const ip = req.headers["x-forwarded-for"] || req.ip || "unknown";
  const rateLimitRef = db.collection("rate_limits").doc(ip);
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  try {
    const rateLimitDoc = await rateLimitRef.get();
    if (rateLimitDoc.exists) {
      const timestamps = (rateLimitDoc.data().timestamps || []).filter(
        (t) => t > oneHourAgo
      );
      if (timestamps.length >= RATE_LIMIT) {
        return res.status(429).json({ error: "Too many requests" });
      }
      timestamps.push(now);
      await rateLimitRef.set({ timestamps });
    } else {
      await rateLimitRef.set({ timestamps: [now] });
    }

    // Store the email (using email as doc ID deduplicates automatically)
    await db.collection("waitlist").doc(email).set({
      email: email,
      createdAt: Firestore.FieldValue.serverTimestamp(),
      ip: ip,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});
