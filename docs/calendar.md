---
title: "Subscribable calendar"
description: "Subscribe to Ebb end-of-life dates in Google Calendar, Apple Calendar, or Outlook."
layout: doc
permalink: /calendar/
---

# Subscribable calendar

Ebb publishes [iCalendar](https://www.rfc-editor.org/rfc/rfc5545) feeds of lifecycle deadlines. A feed is a static file on the site. It changes when the site is published from `main`. Calendar apps fetch the latest published file on their own schedules.

The aggregate feeds include deadlines from the last 30 days and the next 24 months. A component feed exists only when that component still has a deadline ahead, and it lists those future deadlines.

## Feeds

| Feed | URL |
| :--- | :--- |
| Everything | <https://velella.sh/ebb/api/v1/calendar/all.ics> |
| One ecosystem | <https://velella.sh/ebb/api/v1/calendar/npm.ics> |
| Node.js ecosystem | <https://velella.sh/ebb/api/v1/calendar/nodejs.ics> |
| Node.js runtime | <https://velella.sh/ebb/api/v1/calendar/generic/nodejs.ics> |

Replace `npm` with any ecosystem name, such as `python` or `github-actions`. A component feed follows the static API path with a `.ics` suffix. Component documents in the static API include a `calendar` URL when that file exists.

## Google Calendar

1. Open [Google Calendar](https://calendar.google.com/) on the web.
2. Next to **Other calendars**, choose **+** and then **From URL**.
3. Paste a feed URL from the table and add the calendar.

Google refreshes a subscribed calendar on its own schedule.

## Apple Calendar

1. In Calendar, choose **File → New Calendar Subscription**.
2. Paste a feed URL and continue.
3. Set **Auto-refresh** to every day or every week.

## Outlook

1. Open Outlook on the web and choose **Add calendar**.
2. Choose **Subscribe from web**.
3. Paste a feed URL and import it.

Outlook refreshes the subscription on its own schedule.

## From code

`toICal` renders the same kind of calendar for a filter. By default it uses the latest review date in the selected data. Pass `asOf` to set the start of the window:

```ts
import { toICal } from "@velella/ebb";

const ics = toICal({ ecosystem: "nodejs", within: "24m", asOf: "2026-11-12" });
```

The same rules and the same dates always produce the same bytes.
