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
  const response = await client.responses.create({
    model: MODEL,
    response_format: { type: "json_object" },
    input: [
      {
        role: "system",
        content:
          "You are an operations analyst. Respond ONLY with valid JSON that matches the requested schema. No extra text."
      },
      { role: "user", content: buildPrompt(incident) }
    ]
  });
  const text = response.output_text || "";
  try {
    return JSON.parse(text);
  } catch (error) {
    return { title: incident.Number || "", error: "Invalid JSON summary", raw: text };
  }
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
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

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });

  req.on("end", async () => {
    try {
      const payload = JSON.parse(body || "{}");
      const incidents = Array.isArray(payload.incidents) ? payload.incidents : [];
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const summaries = [];
      for (const incident of incidents) {
        const structured = await summarizeIncident(client, incident);
        summaries.push({
          number: incident.Number || incident.number || "",
          summary: typeof structured === "string" ? structured : "",
          structured: typeof structured === "object" ? structured : null
        });
      }

      sendJson(res, 200, { summaries });
    } catch (error) {
      sendJson(res, 500, { error: String(error) });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Local LLM server running on http://localhost:${PORT}`);
});
