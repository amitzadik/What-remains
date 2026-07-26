function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var data = JSON.parse(e.postData.contents);

  // Login verification: match a stored row by email + 4-digit code.
  // Codes may be stored as numbers, so normalize both sides to a
  // zero-padded 4-char string and compare as strings; emails are
  // trimmed + lowercased before comparing.
  if (data.action === "login") {
    var email = String(data.email || "").trim().toLowerCase();
    var code  = String(data.code || "").padStart(4, "0");
    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      var row = values[i];
      var rowEmail = String(row[2] || "").trim().toLowerCase();
      var rowCode  = String(row[3] || "").padStart(4, "0");
      if (rowEmail === email && rowCode === code) {
        return ContentService.createTextOutput(JSON.stringify({
          ok: true, code: rowCode, name: row[1]
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: false }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // File upload: store the file inside the drawer's own Drive folder (by code)
  // and record ONE archive item for it. Every upload creates a new Drive file
  // and a new row — nothing is ever keyed by file type, so a second photo never
  // lands on top of the first, and each row carries the description that was
  // written for that exact file.
  if (data.action === "upload") {
    var upCode = String(data.code || "").padStart(4, "0");
    var folder = getOrCreateCodeFolder_(upCode);
    var bytes = Utilities.base64Decode(data.data || "");
    var blob = Utilities.newBlob(bytes, data.mimeType || "application/octet-stream", data.filename || "file");
    var newFile = folder.createFile(blob);
    // Make it viewable by anyone with the link so the archive can show it.
    try { newFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (shareErr) {}
    var item = appendArchiveItem_(upCode, newFile, data);
    return ContentService.createTextOutput(JSON.stringify({
      ok: true, id: newFile.getId(), name: newFile.getName(), item: item
    })).setMimeType(ContentService.MimeType.JSON);
  }

  sheet.appendRow([
    new Date(),
    data.name || "",
    data.email || "",
    data.code || "",
    data.q1 || "", data.q2 || "", data.q3 || "", data.q4 || "",
    data.q5 || "", data.q6 || "", data.q7 || "",
    data.legacy_text || "",
    data.phone || ""
  ]);

  // Give every new drawer its own Drive folder right away (named by code),
  // even before any file is uploaded.
  getOrCreateCodeFolder_(data.code);

  return ContentService.createTextOutput(JSON.stringify({ result: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}
function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

  // Login verification via query params. Served over GET so it works with
  // JSONP (a plain cross-origin fetch to Apps Script is CORS-blocked) and
  // never writes a row to the sheet.
  var p = (e && e.parameter) || {};
  if (p.action === "login") {
    var loginEmail = String(p.email || "").trim().toLowerCase();
    var loginCode  = String(p.code || "").padStart(4, "0");
    var rows = sheet.getDataRange().getValues();
    var result = { ok: false };
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var rowEmail = String(row[2] || "").trim().toLowerCase();
      var rowCode  = String(row[3] || "").padStart(4, "0");
      if (rowEmail === loginEmail && rowCode === loginCode) {
        result = { ok: true, code: rowCode, name: row[1] };
        break;
      }
    }
    var loginOut = JSON.stringify(result);
    if (p.callback) {
      return ContentService.createTextOutput(p.callback + "(" + loginOut + ")")
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(loginOut).setMimeType(ContentService.MimeType.JSON);
  }

  // List a drawer's archive items. The Drive folder stays the source of truth
  // for WHICH files exist (so nothing a user ever uploaded can be lost by a
  // missing row); the ArchiveItems sheet supplies each file's own description,
  // creation time and pixel size, joined on the Drive file id. Files that
  // predate the sheet simply come back with an empty description instead of
  // being dropped. Sorted oldest-first so every surface shows one order.
  if (p.action === "files") {
    var fCode = String(p.code || "").padStart(4, "0");
    var fFolder = getOrCreateCodeFolder_(fCode);
    var meta = readArchiveItemsByFileId_(fCode);
    var it = fFolder.getFiles();
    var files = [];
    while (it.hasNext()) {
      var fl = it.next();
      var mime = fl.getMimeType();
      var type = mime.indexOf("image/") === 0 ? "image"
               : mime.indexOf("video/") === 0 ? "video" : "other";
      var fileId = fl.getId();
      var row = meta[fileId] || null;
      files.push({
        id: (row && row.id) || fileId,   // stable per uploaded file
        fileId: fileId,
        name: fl.getName(),
        mime: mime,
        type: type,
        description: row ? row.description : "",
        createdAt: row && row.createdAt
          ? row.createdAt
          : toIso_(fl.getDateCreated()),
        width: row ? row.width : 0,
        height: row ? row.height : 0
      });
    }
    files.sort(function(a, b) {
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    });
    var filesOut = JSON.stringify({ ok: true, files: files, items: files });
    if (p.callback) {
      return ContentService.createTextOutput(p.callback + "(" + filesOut + ")")
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(filesOut).setMimeType(ContentService.MimeType.JSON);
  }

  var values = sheet.getDataRange().getValues();
  var entries = values.slice(1)
    .filter(function(r){ return r[1]; })            // יש שם
    .map(function(r){
      return { name: r[1], code: ("000" + r[3]).slice(-4), legacy_text: r[11] };
    });
  var out = JSON.stringify({ entries: entries, count: entries.length });
  var cb = e && e.parameter && e.parameter.callback;
  if (cb) {
    return ContentService.createTextOutput(cb + "(" + out + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// Archive items — one row per uploaded file
// ============================================================
// The personal archive is a LIST, never a set of type-keyed slots: a drawer can
// hold any number of photos, scans, notes or recordings, and each one owns its
// own description. Every upload appends a row here; no row is ever overwritten,
// and no row is keyed by anything but the one Drive file it was written for.
var ARCHIVE_SHEET_NAME = "ArchiveItems";
var ARCHIVE_HEADERS = ["id", "code", "fileId", "fileName", "mimeType", "type",
                       "description", "createdAt", "width", "height"];

function getOrCreateArchiveSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ARCHIVE_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(ARCHIVE_SHEET_NAME);
    sh.appendRow(ARCHIVE_HEADERS);
  }
  return sh;
}

function toIso_(d) {
  try { return (d instanceof Date) ? d.toISOString() : String(d || ""); }
  catch (e) { return ""; }
}

function appendArchiveItem_(code, file, data) {
  var item = {
    id: file.getId(),                    // unique + stable: one Drive file, one item
    code: code,
    fileId: file.getId(),
    fileName: String(data.filename || file.getName() || ""),
    mimeType: String(data.mimeType || file.getMimeType() || ""),
    type: String(data.mimeType || "").indexOf("image/") === 0 ? "image"
        : String(data.mimeType || "").indexOf("video/") === 0 ? "video" : "other",
    description: String(data.description || ""),
    createdAt: toIso_(new Date()),
    width: Number(data.width) || 0,
    height: Number(data.height) || 0
  };
  try {
    getOrCreateArchiveSheet_().appendRow([
      item.id, item.code, item.fileId, item.fileName, item.mimeType, item.type,
      item.description, item.createdAt, item.width, item.height
    ]);
  } catch (err) { /* the file itself is already safe in Drive */ }
  return item;
}

// Every archive item for one drawer, indexed by the Drive file it describes.
function readArchiveItemsByFileId_(code) {
  var byFileId = {};
  try {
    var values = getOrCreateArchiveSheet_().getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      var row = values[i];
      if (String(row[1] || "").padStart(4, "0") !== code) continue;
      var fileId = String(row[2] || "");
      if (!fileId) continue;
      byFileId[fileId] = {
        id: String(row[0] || fileId),
        fileName: String(row[3] || ""),
        mimeType: String(row[4] || ""),
        type: String(row[5] || ""),
        description: String(row[6] || ""),
        createdAt: toIso_(row[7]),
        width: Number(row[8]) || 0,
        height: Number(row[9]) || 0
      };
    }
  } catch (err) { /* no sheet yet — every file simply has no description */ }
  return byFileId;
}

// Returns the Drive subfolder for a drawer's 4-digit code, creating it under
// the fixed parent folder on first use (idempotent).
function getOrCreateCodeFolder_(code) {
  var name = String(code || "").padStart(4, "0");
  var parent = DriveApp.getFolderById("1mQrtBKfU2MCdVi3hUTnuGMpMimp6uSTn");
  var existing = parent.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return parent.createFolder(name);
}
