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
  return ContentService.createTextOutput(JSON.stringify({ result: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}
function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
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
