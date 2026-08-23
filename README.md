# Weekend Calendar

A GitHub Pages site that shows only **Friday, Saturday, and Sunday**, laid out like Google Calendar’s month view. Each weekend is a row: three day cells, then a blank gap so the grid still matches a 7-day month.

```
FRI   SAT   SUN   │
Oct 2 Oct 3 Oct 4 │
Oct 9 Oct10 Oct11 │
 ...
```

All-day and multi-day events render as colored bars that span across the weekend. Timed events use the familiar dot + time + title list, including a “N more” overflow.

## Run locally

```bash
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000). Sample events load until you connect Google Calendar.

## Connect your Google Calendar

The page talks to Google from your browser (read-only). You need an OAuth client ID:

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **Google Calendar API**.
3. Configure the OAuth consent screen. Add your own Google account as a test user.
4. Create credentials → **OAuth client ID** → application type **Web application**.
5. Authorized JavaScript origins:
   - `http://localhost:8000`
   - `http://127.0.0.1:8000`
   - `https://<your-username>.github.io`
6. In the app, open Settings, paste the client ID, and click **Save & connect**.

You can also put the client ID in `config.js` (`window.WEEKEND_CALENDAR_CLIENT_ID`).

## GitHub Pages

In the repository: **Settings → Pages → Deploy from a branch → `main` / root**.
The site will be at `https://<your-username>.github.io/weekend-calendar/`.
