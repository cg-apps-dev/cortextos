/**
 * Auto-size Meta Ad Upload Sheet preview rows.
 *
 * Rule (Adam, 2026-06-02):
 *   - A row whose preview is a 1x1 image            -> height 250 px
 *   - A row whose preview is a 9x16 image (no 1x1)  -> height 350 px
 *
 * Works across the four product tabs. A row "has a preview" when column A holds
 * an =IMAGE() formula; the height is then chosen by whether that row's "1x1" or
 * "9x16" asset cell is filled. Columns are located by HEADER NAME (not letter),
 * so it survives the sheet's column drift. Idempotent: only resizes a row whose
 * current height differs from the target.
 *
 * Why this exists: row height is cell FORMATTING, which the upload pipeline's
 * Sheets API access cannot set (no wrapper for it, and raw batchUpdate is blocked
 * for that connection). A sheet-bound Apps Script sidesteps that entirely.
 *
 * SETUP (one time):
 *   1. In the sheet:  Extensions -> Apps Script.  Paste this file. Save.
 *   2. Run  autoSizePreviewRows  once and authorize when prompted.
 *   3. For automatic mode, run  installAutoSizeTrigger  once (adds a time-driven
 *      trigger that runs every 5 minutes). A custom "Ad Previews" menu also
 *      appears in the sheet for manual runs.
 */

var PREVIEW_TABS = ['IMAGES (Flower)', 'IMAGES (Sleep Gummies)', 'VIDEOS (Flower)', 'VIDEOS (Sleep Gummies)'];
var HEIGHT_1X1 = 250;   // px, preview is a 1x1
var HEIGHT_9X16 = 350;  // px, preview is a 9x16 (taller aspect)

function autoSizePreviewRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PREVIEW_TABS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return;

    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
      return String(h).trim();
    });
    var col1x1 = headers.indexOf('1x1') + 1;    // 1-based; 0 when not found
    var col9x16 = headers.indexOf('9x16') + 1;

    var n = lastRow - 1;
    var previewFormulas = sh.getRange(2, 1, n, 1).getFormulas();             // column A
    var a1x1 = col1x1 ? sh.getRange(2, col1x1, n, 1).getValues() : null;
    var a9x16 = col9x16 ? sh.getRange(2, col9x16, n, 1).getValues() : null;

    for (var i = 0; i < n; i++) {
      var row = i + 2;
      var hasPreview = /^=IMAGE\(/i.test(previewFormulas[i][0] || '');
      if (!hasPreview) continue;
      var has1x1 = a1x1 && String(a1x1[i][0]).trim() !== '';
      var has9x16 = a9x16 && String(a9x16[i][0]).trim() !== '';
      var target = has1x1 ? HEIGHT_1X1 : (has9x16 ? HEIGHT_9X16 : null);
      if (!target) continue;
      if (sh.getRowHeight(row) !== target) sh.setRowHeight(row, target);
    }
  });
}

function installAutoSizeTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'autoSizePreviewRows') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('autoSizePreviewRows').timeBased().everyMinutes(5).create();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Ad Previews')
    .addItem('Resize preview rows now', 'autoSizePreviewRows')
    .addItem('Enable auto-resize (every 5 min)', 'installAutoSizeTrigger')
    .addToUi();
}
