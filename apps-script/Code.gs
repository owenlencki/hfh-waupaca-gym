/**
 * Health & Fitness HQ — contact form handler.
 *
 * Receives JSON POSTs from the contact form on the HFH site, emails the
 * submission to TO_EMAIL, and optionally appends a row to a Google Sheet.
 *
 * Deploy as: Web app, "Execute as: Me", "Who has access: Anyone".
 * See README.md in this folder. Every edit needs a NEW version published.
 */

/* ============================================================
   CONFIG — edit these two constants
   ============================================================ */

/**
 * TO_EMAIL — where submissions are delivered.
 * Change this to route the notifications somewhere else (or to a
 * comma-separated list: "a@x.com,b@x.com").
 *
 * TESTING: currently pointed at lenckiowen@gmail.com.
 * Set back to randy@hfhonline.com before handing the site to the client.
 */
var TO_EMAIL = 'lenckiowen@gmail.com';

/**
 * SHEET_ID — optional submission log.
 * Leave as an empty string to email only. To also log every submission,
 * create a Google Sheet and paste its ID here — the long token in the URL:
 *   https://docs.google.com/spreadsheets/d/<THIS_PART_IS_THE_ID>/edit
 * The script writes to the FIRST sheet tab and adds a header row if the
 * sheet is empty. A Sheet failure never blocks the email.
 */
var SHEET_ID = '';

/* Timezone used for the timestamp in the email body and the Sheet row. */
var TIMEZONE = 'America/Chicago';


/* ============================================================
   POST — form submissions
   ============================================================ */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut({ ok: false, message: 'No form data received.' });
    }

    var data = JSON.parse(e.postData.contents);

    // Honeypot: bots fill the hidden "website" field, humans never see it.
    // Return success so the bot has no signal that it was caught, and send
    // nothing at all. Silent drop.
    if (data.website && String(data.website).trim() !== '') {
      return jsonOut({ ok: true });
    }

    var name    = trimField(data.name);
    var email   = trimField(data.email);
    var phone   = trimField(data.phone);
    var message = trimField(data.message);

    var missing = [];
    if (!name)    missing.push('name');
    if (!email)   missing.push('email');
    if (!message) missing.push('message');

    if (missing.length) {
      return jsonOut({
        ok: false,
        message: 'Missing required field(s): ' + missing.join(', ') + '.'
      });
    }

    var timestamp = Utilities.formatDate(new Date(), TIMEZONE, 'EEEE, MMMM d, yyyy \'at\' h:mm a z');

    var body = [
      'New contact form submission from the HFH website.',
      '',
      'Name:    ' + name,
      'Email:   ' + email,
      'Phone:   ' + (phone || '(not provided)'),
      '',
      'Message:',
      message,
      '',
      '---',
      'Submitted: ' + timestamp
    ].join('\n');

    // replyTo is what makes "Reply" in the inbox go to the customer instead
    // of back to the account that owns this script.
    MailApp.sendEmail({
      to: TO_EMAIL,
      replyTo: email,
      subject: 'New contact form submission from ' + name,
      body: body
    });

    // Optional Sheet log — isolated so a Sheet problem (bad ID, revoked
    // access, deleted file) can never cost us the email that already sent.
    if (SHEET_ID) {
      try {
        appendToSheet([timestamp, name, email, phone, message]);
      } catch (sheetErr) {
        console.error('Sheet append failed: ' + sheetErr);
      }
    }

    return jsonOut({ ok: true });

  } catch (err) {
    console.error('doPost failed: ' + err);
    return jsonOut({ ok: false, message: 'Server error. Please try again or call us.' });
  }
}


/* ============================================================
   GET — smoke test the deployment in a browser
   ============================================================ */

function doGet(e) {
  return jsonOut({
    ok: true,
    status: 'HFH contact form endpoint is live.',
    method: 'Send a POST with JSON: {name, email, phone, message, website}',
    sheetLogging: SHEET_ID ? 'enabled' : 'disabled',
    time: Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss z')
  });
}


/* ============================================================
   HELPERS
   ============================================================ */

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function trimField(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function appendToSheet(row) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'Name', 'Email', 'Phone', 'Message']);
  }
  sheet.appendRow(row);
}
