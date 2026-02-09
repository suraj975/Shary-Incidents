const http = require("http");
require("dotenv").config();
const OpenAIImport = require("openai");

const OpenAI = OpenAIImport.default || OpenAIImport;

const PORT = process.env.PORT || 8787;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

function buildPrompt(incident) {
  return `Summarize the incident using the JSON input below.

Return ONLY valid JSON with this exact schema:
{
  "title": "INC123",
  "what_happened": "string",
  "key_timeline": ["YYYY-MM-DD HH:MM:SS - event", "..."],
  "current_application_state": {
    "status": "string",
    "application_id": "string",
    "presale_no": "string",
    "emirates_id": "string",
    "chassis_no": "string",
    "details": "string"
  },
  "evidence": ["string", "..."],
  "attachments": ["fileName (size) - url", "..."]
}

Rules:
- Use the incident "Number" as the title.
- Explain what happened in plain English, based on detail.activity.
- Timeline: include 3–5 key events only.
- Current state: use applicationData if present; otherwise leave fields empty.
- Evidence: short bullets derived from work notes/field changes.
- Attachments: include uploaded images if present.
- Do not invent anything.

JSON:
${JSON.stringify(incident, null, 2)}`;
}

async function summarizeIncident(client, incident) {
  // Responses API: response_format -> text.format
  const response = await client.responses.create({
    model: MODEL,
    input: [
      {
        role: "system",
        content:
          "You are an operations analyst. Respond ONLY with valid JSON that matches the requested schema. No extra text.",
      },
      { role: "user", content: buildPrompt(incident) },
    ],
    text: {
      format: { type: "json_object" },
    },
  });

  const text = response.output_text || "";

  try {
    return JSON.parse(text);
  } catch {
    return {
      title: incident.Number || incident.number || "",
      what_happened: "",
      key_timeline: [],
      current_application_state: {
        status: "",
        application_id: "",
        presale_no: "",
        emirates_id: "",
        chassis_no: "",
        details: "",
      },
      evidence: [],
      attachments: [],
      error: "Invalid JSON summary",
      raw: text,
    };
  }
}

function sendJson(res, statusCode, data) {
  const body = statusCode === 204 ? "" : JSON.stringify(data ?? {}, null, 2);

  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });

  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    if (req.method !== "POST" || req.url !== "/summarize") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      sendJson(res, 500, { error: "Missing OPENAI_API_KEY" });
      return;
    }

    const raw = await readBody(req);
    const payload = JSON.parse(raw || "{}");
    const incidents = Array.isArray(payload.incidents) ? payload.incidents : [];

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const summaries = [];
    for (const incident of incidents) {
      const structured = await summarizeIncident(client, incident);

      summaries.push({
        number: incident.Number || incident.number || "",
        // structured is an object (or a fallback object). summary string isn't needed.
        structured,
      });
    }

    sendJson(res, 200, { summaries });
  } catch (error) {
    sendJson(res, 500, { error: String(error?.message || error) });
  }
});

server.listen(PORT, () => {
  console.log(`Local LLM server running on http://localhost:${PORT}`);
});
