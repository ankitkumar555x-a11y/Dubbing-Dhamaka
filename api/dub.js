// Awaaz Badlo - backend (Vercel serverless function)
// API key Vercel ke Environment Variables mein rehti hai: ELEVENLABS_API_KEY

const BASE = "https://api.elevenlabs.io/v1/dubbing/project";

async function el(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, ...(options.headers || {}) },
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = { raw: text };
  }
  if (!r.ok) {
    const d = data.detail;
    const msg =
      (d && (d.message || (typeof d === "string" ? d : JSON.stringify(d)))) ||
      data.raw ||
      "ElevenLabs error (" + r.status + ")";
    throw new Error(msg);
  }
  return data;
}

module.exports = async (req, res) => {
  if (!process.env.ELEVENLABS_API_KEY) {
    return res
      .status(500)
      .json({ error: "ELEVENLABS_API_KEY Vercel ki settings mein add nahi hui hai." });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Sirf POST allowed hai." });
  }

  let body = req.body || {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }

  try {
    // Phone se video upload (Vercel Blob)
    if (body.type === "blob.generate-client-token" || body.type === "blob.upload-completed") {
      const { handleUpload } = await import("@vercel/blob/client");
      const out = await handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async () => ({
          allowedContentTypes: ["video/*", "audio/*"],
          maximumSizeInBytes: 300 * 1024 * 1024,
          addRandomSuffix: true,
        }),
        onUploadCompleted: async () => {},
      });
      return res.status(200).json(out);
    }

    // Step 1: dubbing project shuru karo
    if (body.action === "start") {
      const url = String(body.url || "").trim();
      if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ error: "Sahi video link daalo (http ya https se shuru)." });
      }
      const form = new FormData();
      form.append("source_url", url);
      form.append("reference", "Awaaz Badlo");
      form.append("model_id", "dubbing_v1");
      if (body.source_lang && body.source_lang !== "auto") {
        form.append("source_language", String(body.source_lang));
      }
      const p = await el(BASE, { method: "POST", body: form });
      return res.status(200).json({ project_id: p.project_id });
    }

    // Step 2: status check karo (aur zarurat par language add karo)
    if (body.action === "check") {
      const pid = body.project_id;
      const lang = body.lang || "hi";
      if (!pid) return res.status(400).json({ error: "project_id missing hai." });

      if (!body.language_id) {
        const p = await el(BASE + "/" + pid);
        if (p.status === "failed") {
          return res.status(200).json({
            stage: "failed",
            error: "Video prepare nahi ho paya. Link public aur seedha video/audio ka hona chahiye.",
          });
        }
        if (p.status !== "ready") {
          return res.status(200).json({ stage: "preparing" });
        }
        const l = await el(BASE + "/" + pid + "/language", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_language: lang }),
        });
        return res.status(200).json({ stage: "dubbing", language_id: l.language_id });
      }

      const l = await el(BASE + "/" + pid + "/language/" + body.language_id);
      if (l.status === "failed") {
        return res.status(200).json({ stage: "failed", error: "Dubbing fail ho gayi. Dobara try karo." });
      }
      if (l.status === "completed") {
        return res.status(200).json({ stage: "done", outputs: l.outputs || {} });
      }
      return res.status(200).json({ stage: "dubbing", language_id: body.language_id });
    }

    return res.status(400).json({ error: "Unknown action." });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Kuch gadbad ho gayi." });
  }
};
