const fs = require("fs");
const path = require("path");

const OpenAIImport = require("openai");
const OpenAI = OpenAIImport.default || OpenAIImport;

function readJson(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeText(filePath, text) {
  fs.writeFileSync(filePath, text);
}

function getArgValue(flag, fallback = "") {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function buildPrompt(incident) {
  return `You are an operations analyst. Summarize the incident using the JSON input below.

Rules:
- Use the incident "Number" as the title.
- Explain what happened, in plain English, based on the detail.activity entries.
- Include key timestamps and key actions (emails, work notes, field changes, attachments).
- Mention any important identifiers (ApplicationId, presaleNo, EmiratesId, chassisNo) if present.
- applicationData represents the latest known application state — use it to state the final status and important fields.
- Be concise but complete. Do not invent anything.

Output format:
Title: <Number>
Summary:
- What happened:
- Key timeline:
- Current application state:
- Evidence (from activity/work notes):
- Attachments:

JSON:
${JSON.stringify(incident, null, 2)}`;
}

async function summarizeIncident(client, model, incident) {
  const response = await client.responses.create({
    model,
    input: [
      { role: "system", content: "You summarize incident records accurately and concisely." },
      { role: "user", content: buildPrompt(incident) }
    ]
  });
  return response.output_text || "";
}

async function run() {
  const inputPath = getArgValue("--input", "");
  const outputPath = getArgValue("--output", "");
  const outputFormat = getArgValue("--format", "json");
  const model = getArgValue("--model", "gpt-4.1-mini");

  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY in environment.");
    process.exit(1);
  }

  if (!inputPath) {
    console.error("Usage: node scripts/summarize-incidents.js --input <file.json> --output <out.json|out.md> [--format json|md] [--model model]");
    process.exit(1);
  }

  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = outputPath ? path.resolve(outputPath) : "";
  const incidents = readJson(resolvedInput);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const summaries = [];
  for (const incident of incidents) {
    const text = await summarizeIncident(client, model, incident);
    summaries.push({
      number: incident.Number || incident.number || "",
      summary: text
    });
  }

  if (outputFormat === "md") {
    const markdown = summaries.map((item) => item.summary).join("\n\n");
    if (resolvedOutput) {
      writeText(resolvedOutput, markdown);
    } else {
      console.log(markdown);
    }
  } else {
    if (resolvedOutput) {
      writeJson(resolvedOutput, summaries);
    } else {
      console.log(JSON.stringify(summaries, null, 2));
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
