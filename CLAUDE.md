# Aircall Analytics — Project Context

## About Dustin
- Admin/operator of this platform for Specialized Property Management
- Not a traditional software engineer but comfortable reading and reasoning about code
- Cares about doing things correctly, not quickly — no artificial deadlines
- Direct communication preferred — honest assessments, no hedging
- Will push back on recommendations but is open to being wrong with good reasoning
- New to Claude Code as of this project

## Collaboration Style
- Make one logical change at a time; ask if terminal is clean before moving to the next
- Always add WHY comments at non-obvious decision points
- Organize code into logical sections with headers
- Don't maintain hardcoded mappings that require updates when staffing changes
- Dustin has nodemon running locally — every file save auto-restarts the server
- Production is deployed on Railway via GitHub push

## Project Overview
Aircall observability platform that captures webhooks, enriches with API data, reconstructs call routing, and generates executive dashboards. Neither Aircall nor HubSpot surfaces routing detail — this platform is the operational source of truth for Specialized Property Management.

**Stack:** Node.js, Express, local JSON storage, Railway deployment, GitHub CI/CD

## Key Files
- `index.js` — Express server, webhook handler, all routes, scheduled sync
- `logic/callProcessing.js` — call record construction, routing analysis, derived flags
- `reports/reportFunctions.js` — metrics computation, report writers
- `reports/executiveHtml.js` — HTML dashboard builder
- `config/teamMappings.js` — hardcoded team structures and role overrides
- `calls.json` — primary data store (in-memory at runtime, persisted on every change)
- `user_status_history.json` — agent availability audit log
- `aircall_roster.json` — synced from Aircall API via /sync-roster

## KPI Philosophy (critical design decision)
- **Company KPIs:** 1 call_id = 1 company call. IVR rings 5 people = still 1 company call.
- **Ring attempt KPIs:** 1 ring cycle per agent = 1 ring attempt. Measures employee responsiveness separately from company-level answer rate.
- These two levels must never be conflated in reporting.

## DID Attribution
Personal DID numbers in Aircall are named `[Full Name] DID` (e.g. "Ana Smith DID"). The system strips " DID" and matches against the roster to attribute missed calls to the owner. No manual `numberOwners` map — too much maintenance overhead as staffing changes. `numberOwners` in `index.js` is intentionally always `{}`.

## Data Model (per call record)
```
call_core          — timestamps, direction, result, answered_by
webhook_events     — raw event log
api_snapshots      — full Aircall API response (v1_call, v1_number, etc.)
routing_analysis   — rang_agents, declined_agents, answered_by, DID owner
derived_flags      — answered, missed, voicemail, callback_after_miss, etc.
```

## Backfill System
Exists because Aircall webhooks occasionally miss events entirely.
- `/backfill-test` — pulls all calls since 7am today, upserts each one
- `/backfill-call/:id` — backfills a single call by ID
- Scheduled sync — runs hourly, imports only calls not already in `calls[]`

## User Status History
Currently a **passive audit log** of agent availability/wrap-up/substatus changes. Originally intended to explain why a DID owner didn't answer, but that path (`numberOwners → did_owner_email`) is always null so it's not actively wired into reporting. Future feature: surface contextual explanations like "Ana was on wrap-up when this rang."

## Outbound Calls
Tracked but **intentionally excluded from ring attempt KPIs**. No outbound KPIs defined yet. Only used for callback detection. Future intent is to show time-on-phone and explain why agents missed inbound calls.

## Bugs Fixed (session 2026-06-01)
All of these were fixed and are no longer issues:
1. `enrichCallFromApi` — was silently doing nothing; now imports `aircallApi` directly
2. `addUserStatusSnapshot` — wrong argument order at call sites; fixed
3. Duplicate `backfillCall` stub and duplicate route registration — removed
4. Metrics scope — `getModifiedCompanyOutcomes`, `getMissedCallBreakdown`, `getRingAttempts`, `buildExceptions`, `getDeclineBehavior` were operating on all-time data instead of today's filtered calls
5. `detectCallbacks` — was running 3-4x per request; now runs once in `getExecutiveMetrics`
6. Business hours check — now correctly excludes weekends
7. Duplicate `getExecutiveMetrics` export — removed
8. Dead helper functions in `index.js` — removed

## Still On The Table (future work)
- User status history wired into routing explanations
- Outbound call activity metrics
- Webhook signature verification (Aircall supports HMAC signing)
- Admin route protection (`/reset`, `/start-reporting`, `/stop-reporting` are unauthenticated GETs)
- `backfillCall` and `syncRecentAircallCalls` use inline raw `fetch` with hardcoded auth — should go through `aircallApi` service
