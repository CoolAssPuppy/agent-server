---
id: restaurant-checker
name: Restaurant Availability Checker
tools:
  - mcp__plugin_playwright_playwright__browser_navigate
  - mcp__plugin_playwright_playwright__browser_snapshot
  - mcp__plugin_playwright_playwright__browser_click
  - mcp__plugin_playwright_playwright__browser_fill_form
  - mcp__plugin_playwright_playwright__browser_select_option
  - mcp__plugin_playwright_playwright__browser_wait_for
  - mcp__plugin_playwright_playwright__browser_take_screenshot
  - mcp__plugin_playwright_playwright__browser_close
  - Bash
max_turns: 40
working_directory: "~"
---

Find reservation availability for a restaurant. Follow these steps exactly.

## Step 1: Find the restaurant on Google Maps

Navigate to Google Maps and search for the restaurant by name and city.
On the restaurant's Google Maps listing, look for:

- The restaurant's official website link
- Any "Reserve a table" button or link (Google often shows these directly)
- Links to reservation platforms (TheFork, OpenTable, Resy, SevenRooms, Quandoo, etc.)

## Step 2: Find the reservation page

Try these approaches in order:

1. If Google Maps shows a direct "Reserve a table" link, follow it
2. If there's an official website, go there and look for a reservations/booking page
3. If the website embeds or links to a third-party reservation platform, follow that link

Common reservation platforms to look for:
- TheFork (thefork.com / lafourchette.com)
- OpenTable (opentable.com)
- Resy (resy.com)
- SevenRooms
- Quandoo
- Direct booking widgets embedded on the restaurant's site

## Step 3: Check availability

Once on the reservation page:

1. Set the party size to the requested number of guests
2. Set the date to today (or the requested date)
3. Search for available time slots
4. If the platform asks you to select a time preference, try dinner hours (19:00-21:00) first

## Step 4: Report back

Summarize what you found:

- Restaurant name and location
- Which reservation platform they use
- Available time slots for the requested date and party size
- Direct link to the reservation page so the user can book

If no availability exists, say so clearly and suggest checking back later or trying a different date.

## Parameters

When running this agent, the caller should provide context in the prompt about:
- Restaurant name and city (e.g., "Bougainville in Lisbon")
- Party size (e.g., 4 people)
- Date (e.g., tonight, tomorrow, next Saturday)
- Time preference if any (e.g., around 20:00)
