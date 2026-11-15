---
title: "Subscribable calendar"
description: "Subscribe to Ebb end-of-life dates in Google Calendar, Apple Calendar, or Outlook."
layout: doc
permalink: /calendar/
---

# Subscribable calendar

Ebb publishes [iCalendar](https://www.rfc-editor.org/rfc/rfc5545) feeds of lifecycle deadlines. A feed is a static file on the site. It changes when the site is published from `main`. It does not update in real time, and a calendar application usually fetches a subscription about once a day.

The aggregate feeds include deadlines from the last 30 days and the next 24 months. A component feed exists only when that component still has a deadline ahead, and it lists those future deadlines.

## Feeds

| Feed | URL |
| :--- | :--- |
| Everything | <https://velella.sh/ebb/api/v1/calendar/all.ics> |
| One ecosystem | <https://velella.sh/ebb/api/v1/calendar/npm.ics> |
| Node.js ecosystem | <https://velella.sh/ebb/api/v1/calendar/nodejs.ics> |
| Node.js runtime | <https://velella.sh/ebb/api/v1/calendar/generic/nodejs.ics> |

Replace `npm` with any ecosystem name, such as `pypi` or `github-actions`. A component feed follows the static API path with a `.ics` suffix, for example `calendar/npm/left-pad.ics`. Component documents in the static API include a `calendar` URL when that file exists.

## Google Calendar

1. Open [Google Calendar](https://calendar.google.com/) on the web.
2. Next to **Other calendars**, choose **+** and then **From URL**.
3. Paste a feed URL from the table and add the calendar.

Google refreshes a subscribed calendar on its own schedule, typically within a day. Adding the URL does not stream updates as they happen.

## Apple Calendar

1. In Calendar, choose **File → New Calendar Subscription**.
2. Paste a feed URL and continue.
3. Set **Auto-refresh** to every day or every week.

The Mac or iPhone fetches the file on that interval. It will not show a deadline the moment Ebb publishes it.

## Outlook

1. Open Outlook on the web and choose **Add calendar**.
2. Choose **Subscribe from web**.
3. Paste a feed URL and import it.

Outlook also polls the file. Pick a daily refresh if it offers one. The subscription is a copy that catches up after the next fetch, not a live view.

## From code

`toICal` renders the same kind of calendar for a filter. Pass `asOf` and `stamp` when the result must not depend on the clock:

```ts
import { toICal } from "@velella/ebb";

const ics = toICal({ ecosystem: "nodejs", within: "24m", asOf: "2026-11-12" });
```

The same rules and the same dates always produce the same bytes.
