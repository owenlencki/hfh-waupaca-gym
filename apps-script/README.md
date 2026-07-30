# HFH Contact Form — Apps Script Endpoint

`Code.gs` receives the contact form POST from the HFH site, emails it to the
front desk, and optionally logs it to a Google Sheet.

The site side lives in [`../index.html`](../index.html): the `#contact` section
markup, and the `FORM_ENDPOINT` constant at the top of the inline `<script>`.

---

## 1. Create the script

1. Sign in to the Google account that should **send** the notification emails
   (the daily `MailApp` quota belongs to this account, and it appears as the
   sender).
2. Go to <https://script.google.com> → **New project**.
3. Delete the placeholder `myFunction` stub and paste in the full contents of
   `Code.gs`.
4. Rename the project something findable, e.g. `HFH Contact Form`.

## 2. Set the constants

At the top of `Code.gs`:

| Constant   | What to do |
| ---------- | ---------- |
| `TO_EMAIL` | Where submissions are delivered. Accepts a comma-separated list. **Currently set to `lenckiowen@gmail.com` for testing — change to `randy@hfhonline.com` before client handoff.** |
| `SHEET_ID` | Leave `''` to email only. To also log submissions, create a Google Sheet and paste its ID — the long token between `/d/` and `/edit` in its URL. |

The Sheet write is wrapped in its own `try/catch`, so a bad `SHEET_ID` degrades
to "email sent, nothing logged" rather than losing the submission.

## 3. Deploy as a Web App

1. **Deploy** → **New deployment**.
2. Gear icon → select type **Web app**.
3. Configure:
   - **Description:** `v1 — initial`
   - **Execute as:** **Me** (your account sends the mail)
   - **Who has access:** **Anyone**
4. **Deploy**.
5. Authorize when prompted. Google shows an "unverified app" warning because
   this is your own unpublished script — click **Advanced** →
   **Go to \<project name\> (unsafe)** → **Allow**. This is expected for a
   private Apps Script and is not a security problem.
6. Copy the **Web app URL**. It looks like:

   ```
   https://script.google.com/macros/s/AKfycb.................../exec
   ```

   Use the URL ending in **`/exec`**, not `/dev`. The `/dev` URL only works
   while signed in as you and will fail for site visitors.

> **"Who has access: Anyone" is required.** Site visitors are anonymous, so
> "Anyone with Google Account" will reject their submissions.

## 4. Smoke test the deployment

Paste the `/exec` URL straight into a browser. `doGet` should return:

```json
{"ok":true,"status":"HFH contact form endpoint is live.","...":"..."}
```

If you get an error page or a Google sign-in screen instead, the access
setting is wrong — revisit step 3.

To test the `doPost` path from the terminal (this sends a real email):

```bash
curl -sL -H 'Content-Type: text/plain;charset=UTF-8' --data-binary '{"name":"Curl Test","email":"test@example.com","phone":"715-555-0000","message":"Testing.","website":""}' 'YOUR_EXEC_URL'
```

Two flags matter here:

- **`-L` is required.** Apps Script answers a POST with a 302 to
  `script.googleusercontent.com`, which serves the actual response body.
- **Do NOT add `-X POST`.** Combined with `-L` it forces the method to persist
  across the redirect, but the redirect target only accepts GET — you get a
  `405` and a "Page Not Found" HTML page that looks like a broken deployment
  when the endpoint is actually fine. Let `--data-binary` imply the POST so
  curl switches to GET on the redirect the way a browser does.

## 5. Wire the site to the endpoint

In [`../index.html`](../index.html), find this near the top of the inline
`<script>` block and paste the `/exec` URL in:

```js
var FORM_ENDPOINT = 'PASTE_APPS_SCRIPT_URL_HERE';
```

Then submit the live form once and confirm the email arrives.

---

## Editing the script later — publish a NEW version

**Saving the script does not change what the live URL runs.** The deployed web
app is pinned to a *version*, which is a frozen snapshot taken at deploy time.
Edit and save all you like — visitors keep hitting the old code until you
publish a new version.

After any edit to `Code.gs`:

1. **Deploy** → **Manage deployments**.
2. Pick the existing deployment → **pencil / edit** icon.
3. Set **Version** to **New version**.
4. Add a short description of the change.
5. **Deploy**.

Doing it this way keeps the same `/exec` URL, so nothing in `index.html` needs
to change. Creating a *new deployment* instead mints a **different** URL and
you would have to update `FORM_ENDPOINT` too — so edit the existing deployment
unless you specifically want a second endpoint.

Keep `Code.gs` in this repo as the source of truth: edit here, paste into the
Apps Script editor, then publish a new version.

---

## How the CORS setup works (don't "fix" this)

The front end posts **without a `Content-Type` header**:

```js
fetch(FORM_ENDPOINT, { method: 'POST', body: JSON.stringify(formData) })
```

With the header unset, the browser sends `text/plain;charset=UTF-8`, which
makes this a CORS **simple request** — no `OPTIONS` preflight. Apps Script web
apps do not answer preflight requests, so adding
`headers: { 'Content-Type': 'application/json' }` will break submissions with
a CORS error even though the body is still valid JSON. The script reads the raw
body with `JSON.parse(e.postData.contents)`, so the declared MIME type is
irrelevant on the server side.

## Spam handling

The form includes a honeypot field named `website`, positioned off-screen with
`tabIndex={-1}` and `autocomplete="off"`. It is never validated in the browser.
If it arrives with any value, `doPost` returns `{ok: true}` and sends nothing —
a silent drop, so the bot gets no signal that it was filtered.

## Troubleshooting

| Symptom | Cause |
| ------- | ----- |
| CORS error in the browser console | A `Content-Type` header was added to the `fetch`. Remove it. |
| Form shows the error banner, no email | Check **Executions** in the Apps Script editor for the failure. |
| Google sign-in page at the `/exec` URL | **Who has access** isn't set to **Anyone**. |
| Edits have no effect | New version not published — see the section above. |
| No email but `{"ok":true}` returned | Check the sending account's Gmail quota, and the spam folder at `TO_EMAIL`. |
