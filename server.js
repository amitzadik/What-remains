import 'dotenv/config';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');
import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { google } from 'googleapis';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

app.get('/', (req, res) => {
  res.sendFile(process.cwd() + '/index.html');
});// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// הדפסת המודלים הזמינים בטרמינל
async function checkAvailableModels() {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
    const data = await response.json();
    console.log("=== זמינים עבורך Gemini מודלי ===");
    if (data.models) {
      data.models.forEach(m => {
        if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent")) {
          console.log(m.name.replace('models/', ''));
        }
      });
    } else {
      console.log("שגיאה בקבלת מודלים:", data);
    }
    console.log("===============================");
  } catch (err) {
    console.error("נכשלה בדיקת מודלים:", err.message);
  }
}
checkAvailableModels();

// Define JSON Schema so Gemini structures its response perfectly for your print template
const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    onscreen_response: {
      type: SchemaType.STRING,
      description: "Full archival excerpt displayed to the user on screen."
    },
    print_payload: {
      type: SchemaType.OBJECT,
      description: "Data strictly populated for the predefined print template.",
      properties: {
        summary: {
          type: SchemaType.STRING,
          description: "Concise 1-paragraph retrieval summary for the A6 printed record."
        },
        images: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: "Up to 2 selected image URLs or filenames. Empty array if none."
        }
      },
      required: ["summary", "images"]
    },
    print_status_message: {
      type: SchemaType.STRING,
      description: "Must always be exactly: המידע נשלח להדפסה."
    }
  },
  required: ["onscreen_response", "print_payload", "print_status_message"]
};

// ----------------------------------------------------
// 1. Helper Function: Read Specific Folder from Drive
// ----------------------------------------------------
async function getFolderContents(archiveCode) {
  // Initialize Google Drive API (using service account credentials)
  const auth = new google.auth.GoogleAuth({
    keyFile: 'google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });

  // Find folder matching the Archive Code
  const folderSearch = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${archiveCode}' and trashed=false`,
    fields: 'files(id, name)',
  });

  if (folderSearch.data.files.length === 0) {
    throw new Error(`Archive code [${archiveCode}] not found.`);
  }

  const folderId = folderSearch.data.files[0].id;

  // Read files inside this specific folder
  const filesList = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, mimeType, webViewLink)',
  });

  let textArchiveContent = "";
  let imageFiles = [];

  for (const file of filesList.data.files) {
    if (file.mimeType.includes('text') || file.mimeType.includes('json')) {
      // קובץ טקסט רגיל
      const res = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'text' });
      textArchiveContent += `\n--- File: ${file.name} ---\n${res.data}\n`;
    } else if (file.mimeType === 'application/vnd.google-apps.document') {
      // קובץ Google Docs - ייצוא כטקסט נקי
      const res = await drive.files.export({ fileId: file.id, mimeType: 'text/plain' }, { responseType: 'text' });
      textArchiveContent += `\n--- Document: ${file.name} ---\n${res.data}\n`;
    } else if (file.mimeType.includes('image')) {
      imageFiles.push({ name: file.name, url: file.webViewLink });
    }
  }
  return { textArchiveContent, imageFiles };
}

// ----------------------------------------------------
// 2. Main Retrieval API Endpoint
// ----------------------------------------------------
app.post('/api/archive/search', async (req, res) => {
  try {
    const { archiveCode, query } = req.body;

    if (!archiveCode || !query) {
      return res.status(400).json({ error: "Missing archive code or search query." });
    }

    // Fetch ONLY the authenticated folder's content
    const folderData = await getFolderContents(archiveCode);

    // Initialize Gemini Model with Structured JSON Output
    const model = genAI.getGenerativeModel({
      model: "gemini-3.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      },
      systemInstruction: `
You are the archivist of a personal memory archive.
Your purpose is to retrieve existing materials only from the archive folder that is currently open and has been successfully authenticated.
You are not a general assistant.
You do not answer from general knowledge.
You do not invent information.
Your role is to retrieve, organize and present archival materials that already exist.
---
## ARCHIVE ACCESS
Each archive folder belongs to one personal archive.
Every archive folder is protected by:
- a unique archive code which is the password to enter his personal folder.
A signed-in user may access either their own archive or another person's archive only after successfully opening that archive using its correct archive code.
The authenticated archive is the only archive you are allowed to access.

Everything you retrieve must come exclusively from the currently authenticated archive.

## ARCHIVE CONTENT
An archive may contain:
- written responses to seven questions
- the legacy response
- personal writings
- uploaded notes
- photographs
- videos
- scanned documents
- additional archival materials
Every stored item in the authenticated folder is considered part of the archive.
---

## RETRIEVAL
When a retrieval request is submitted:
1. Search only inside the authenticated archive.
2. Search across every available archive item.
3. Retrieve every relevant result.
4. Base every statement only on retrieved materials.
5. Never fabricate information.
6. Never complete missing details.

---

## RETRIEVAL RESULTS
A retrieval request may return multiple relevant results.
When this happens:
- retrieve all relevant materials
- present them together as related archival results
- include related text, photographs, videos and documents when available

---
## ANSWERING
If relevant information exists:
Provide one clear answer based only on the retrieved materials.
If several archival items contribute to the answer, combine them into one coherent summary.
The answer should read as an archival excerpt rather than a conversational reply.
Keep the tone calm, respectful and factual.
Never add information that was not retrieved.

---

## IF NOTHING IS FOUND
If no exact match exists:
Clearly state that no matching material was found inside the archive.
Then retrieve and suggest the closest related materials that exist within the same archive.
Never invent information.
Never speculate.

## PRINT PREPARATION
Each retrieval generates one printed archival record.
Select:
- one concise retrieval summary
- up to two relevant images
If more than two relevant images exist:
Select the two images that best support the retrieved information.
If no relevant images exist:
Print the summary without images.
The printed summary should:
- directly answer the retrieval request
- be concise
- fit within a single short paragraph
- read like an archival excerpt rather than a chatbot response

---
## PRINT TEMPLATE
A predefined print template already exists. Your responsibility is only to populate the existing template.
Populate only the designated placeholders with:
- one retrieval summary
- up to two selected images

---
## PRINTING
After the template has been populated, populate print_status_message with: "המידע נשלח להדפסה."

---
## COMMUNICATION STYLE
Maintain a calm, respectful and restrained tone.
Treat the archive as a collection of personal memories.
Do not behave like a personal assistant.
Do not greet the user.
Do not introduce yourself.
Do not engage in casual conversation.
Be concise.
Be accurate.
Be archival.
      `
    });

    // Pass ONLY the active folder content into the execution prompt
    const promptPayload = `
[AUTHENTICATED FOLDER CODE: ${archiveCode}]

=== WRITTEN ARCHIVE CONTENT ===
${folderData.textArchiveContent}

=== AVAILABLE IMAGE FILES ===
${JSON.stringify(folderData.imageFiles)}

=== USER RETRIEVAL REQUEST ===
${query}
    `;

    const result = await model.generateContent(promptPayload);
    const responseText = JSON.parse(result.response.text());

    // Send structured response to frontend
    res.json(responseText);

  } catch (error) {
    console.error("Archival Retrieval Error:", error);
    res.status(500).json({ error: error.message || "Archive retrieval failed." });
  }
});

app.listen(3000, () => console.log('Archive backend running on port 3000'));
