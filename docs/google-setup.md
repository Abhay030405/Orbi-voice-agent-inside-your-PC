# Connecting Gmail, Calendar and Drive (one time, about 3 minutes)

Dreamwalker talks to Google's own APIs with **your** account. Google requires every app to have its own
sign-in ID (an "OAuth client"), made in your Cloud project. Nothing secret goes into the code.

1. **Turn on the three APIs** (project `dreamwalker-softablitz`), one command:
   ```
   gcloud services enable gmail.googleapis.com calendar-json.googleapis.com drive.googleapis.com --project dreamwalker-softablitz
   ```
2. **Consent screen** (first time only): https://console.cloud.google.com/auth/overview?project=dreamwalker-softablitz
   - App name: Dreamwalker. User type: **External**. Your email as the support and developer contact.
   - **Audience → Test users → Add** your Gmail address (and teammates' if they will use it).
     (In "Testing" mode only these accounts can sign in. That is fine for us; no Google review needed.)
3. **Create the sign-in ID**: https://console.cloud.google.com/auth/clients?project=dreamwalker-softablitz
   → Create client → Application type **Desktop app** → name "Dreamwalker" → Create → **Download JSON**.
4. **Save it** as `%APPDATA%\dreamwalker\google-oauth.json` (rename the downloaded file).
5. Start Dreamwalker and say **"Hey Orbi, connect my Google account."** Your browser opens Google's sign-in;
   pick your account. Google warns "this app isn't verified" (it's yours, in testing): **Continue**.
   It asks for: read mail, send mail, calendar events, see Drive file names. Allow.

Done. Try: "What meetings do I have today?", "Any unread emails from Rahul?", "Find the abstract in my Drive",
"Add a team call tomorrow at 6 pm with a Meet link".

**Safety:** reading mail switches on caution mode (an email could contain instructions); sending an email or
inviting people always asks first, showing exactly what goes out. The sign-in is stored encrypted with
Windows' own protection (`google-token.bin`); "Hey Orbi, disconnect Google" deletes it.
