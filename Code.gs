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

  // File upload: store the file inside the drawer's own Drive folder (by code).
  if (data.action === "upload") {
    var upCode = String(data.code || "").padStart(4, "0");
    var folder = getOrCreateCodeFolder_(upCode);
    var bytes = Utilities.base64Decode(data.data || "");
    var blob = Utilities.newBlob(bytes, data.mimeType || "application/octet-stream", data.filename || "file");
    var newFile = folder.createFile(blob);
    // Make it viewable by anyone with the link so the archive can show it.
    try { newFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (shareErr) {}
    return ContentService.createTextOutput(JSON.stringify({
      ok: true, id: newFile.getId(), name: newFile.getName()
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

  // List the files in a drawer's Drive folder (for the gallery), classified
  // into image / video / other by MIME type.
  if (p.action === "files") {
    var fCode = String(p.code || "").padStart(4, "0");
    var fFolder = getOrCreateCodeFolder_(fCode);
    var it = fFolder.getFiles();
    var files = [];
    while (it.hasNext()) {
      var fl = it.next();
      var mime = fl.getMimeType();
      var type = mime.indexOf("image/") === 0 ? "image"
               : mime.indexOf("video/") === 0 ? "video" : "other";
      files.push({ id: fl.getId(), name: fl.getName(), mime: mime, type: type });
    }
    var filesOut = JSON.stringify({ ok: true, files: files });
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

// Returns the Drive subfolder for a drawer's 4-digit code, creating it under
// the fixed parent folder on first use (idempotent).
function getOrCreateCodeFolder_(code) {
  var name = String(code || "").padStart(4, "0");
  var parent = DriveApp.getFolderById("1mQrtBKfU2MCdVi3hUTnuGMpMimp6uSTn");
  var existing = parent.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return parent.createFolder(name);
}
