require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');

const { aircallApi, fetchAllAircallPages } = require('./services/aircallApi');
const { loadJson, saveJson } = require('./storage/jsonStore');
const { teamMappings, userRoleOverrides } = require('./config/teamMappings');
const { TIMEZONE, AIRCALL_API_RATE_LIMIT_MS } = require('./config/constants');

const {
    isDateCentral,
    writeExecutiveReport,
    writeExecutiveHtmlReport,
    writeUsersHtmlReport,
    writeBackfillHtmlReport,
    writeExceptionsReport,
    getExecutiveMetrics
} = require('./reports/reportFunctions');

const {
    ensureCall,
    updateCallCore,
    updateRoutingAnalysis,
    updateDerivedFlags,
    enrichCallFromApi,
    addUserStatusSnapshot,
    formatTime
} = require('./logic/callProcessing');

const { buildExecutiveHtml } = require('./reports/executiveHtml');


// =============================================================================
// APP SETUP
// =============================================================================

const app = express();
const PORT = process.env.PORT || 3000;

// Captured once at boot. Resets on every deploy/restart.
// Used to scope the live-session team tables to calls captured since this server started.
const SERVER_STARTED_AT = Math.floor(Date.now() / 1000);

app.use(express.json({ limit: '10mb' }));


// =============================================================================
// IN-MEMORY STATE
// Loaded from disk on startup, written back on every change.
// calls and userStatusHistory are mutated in place throughout the request lifecycle.
// =============================================================================

const calls = loadJson('calls.json', {});
const userStatusHistory = loadJson('user_status_history.json', {});

const reportingState = loadJson('reporting_state.json', {
    is_reporting: true,
    started_at: Math.floor(Date.now() / 1000),
    stopped_at: null
});

// numberOwners is intentionally empty. DID attribution is handled via the
// " DID" naming convention on Aircall numbers (e.g. "Ana Smith DID"), not
// a manual map. A manual map would require constant maintenance as staffing changes.
const numberOwners = {};


// =============================================================================
// INTERNAL HELPERS
// =============================================================================

// Persists all in-memory state and regenerates every report file.
// Called after any change to calls or reportingState so the dashboard
// always reflects current data without a separate refresh step.
function writeAllFiles() {
    saveJson('calls.json', calls);
    saveJson('user_status_history.json', userStatusHistory);
    saveJson('reporting_state.json', reportingState);

    const roster = loadJson('aircall_roster.json', { users: [], numbers: [], teams: [] });

    writeExecutiveReport(calls, reportingState);
    writeExecutiveHtmlReport(calls, reportingState, teamMappings, userRoleOverrides, roster, SERVER_STARTED_AT);
    writeExceptionsReport(calls);
}

async function fetchAndWriteUsersReport() {
    const users = await fetchAllAircallPages('/v1/users', 'users');
    const numbers = await fetchAllAircallPages('/v1/numbers', 'numbers');

    console.log(`Total users fetched: ${users.length}`);
    console.log(`Total numbers fetched: ${numbers.length}`);

    writeUsersHtmlReport(users, numbers);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Returns the Unix timestamp for 7:00 AM Central today.
// Used as the "from" boundary when backfilling the current business day.
function getTodayBusinessStartCentralUnix() {
    const now = new Date();

    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now);

    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;

    return Math.floor(new Date(`${year}-${month}-${day}T07:00:00-05:00`).getTime() / 1000);
}


// =============================================================================
// WEBHOOK HANDLER
// =============================================================================

app.post('/webhooks/aircall', async (req, res) => {
    const event = req.body.event;
    const resource = req.body.resource;
    const data = req.body.data || {};
    const timestamp = req.body.timestamp || Math.floor(Date.now() / 1000);

    if (data.user) {
        console.log(
            'USER STATUS:',
            data.user.name || data.user.email || data.user.id,
            '|',
            data.user.availability_status || 'unknown',
            '|',
            data.user.substatus || 'none'
        );
    }

    if (!reportingState.is_reporting) {
        console.log(`IGNORED | reporting stopped | ${resource} | ${event}`);
        res.sendStatus(200);
        return;
    }

    if (resource === 'user') {
        addUserStatusSnapshot(userStatusHistory, event, data, timestamp);
        writeAllFiles();

        console.log(
            `USER STATUS | ${data.name || data.email || data.id} | ${data.availability_status || 'unknown'} / ${data.substatus || 'unknown'}`
        );

        res.sendStatus(200);
        return;
    }

    if (resource !== 'call') {
        res.sendStatus(200);
        return;
    }

    const callId = data.id;

    if (!callId) {
        res.sendStatus(200);
        return;
    }

    const call = ensureCall(calls, callId, data, numberOwners, userStatusHistory);

    if (!call) {
        console.log(`Could not create/find call for callId: ${callId}`);
        res.sendStatus(200);
        return;
    }

    call.webhook_events.push({
        received_at: new Date().toISOString(),
        event,
        timestamp,
        payload: req.body
    });

    updateCallCore(call, data);

    // Capture agent availability at the moment they appear in a call event.
    // This lets us later explain why an agent didn't answer ("was on wrap-up", etc.).
    if (data.user) {
        addUserStatusSnapshot(userStatusHistory, `snapshot_from_${event}`, data.user, timestamp);
    }

    updateRoutingAnalysis(call, event, data, timestamp);

    // Enrich with full API data on the events where the call record is most complete.
    // Aircall webhooks are intentionally sparse; the API gives the full picture.
    if (['call.created', 'call.answered', 'call.ended'].includes(event)) {
        await enrichCallFromApi(call, data);
    }

    updateDerivedFlags(call);
    writeAllFiles();

    console.log(
        `CALL ${callId} | ${event} | ${call.call_core.called_number_name || 'unknown'} | ${call.call_core.result}`
    );

    res.sendStatus(200);
});


// =============================================================================
// DASHBOARD ROUTES
// =============================================================================

app.get('/', (req, res) => {
    res.send('Aircall webhook server running. Open /report to view the dashboard.');
});

app.get('/report', (req, res) => {
    writeAllFiles();
    res.sendFile(path.join(__dirname, 'executive_report.html'));
});

app.get('/users', async (req, res) => {
    await fetchAndWriteUsersReport();
    res.sendFile(path.join(__dirname, 'users_report.html'));
});

app.get('/calls-json', (req, res) => {
    res.sendFile(path.join(__dirname, 'data', 'calls.json'));
});

// Generates (and saves) an HTML snapshot for a specific calendar date.
// Useful for reviewing past days without affecting live reporting state.
app.get('/daily-snapshot', (req, res) => {
    const date = req.query.date;

    if (!date) {
        return res.status(400).send('Missing date. Use /daily-snapshot?date=YYYY-MM-DD');
    }

    const roster = loadJson('aircall_roster.json', { users: [], numbers: [], teams: [] });

    const dayCallsArray = Object.values(calls).filter(call => {
        const ts = call.call_core?.started_at || call.call_core?.created_at || call.timestamp;
        return isDateCentral(ts, date);
    });

    const dayCalls = {};
    dayCallsArray.forEach(call => {
        const id = call.call_core?.call_id || call.id || call.call_id;
        if (id) dayCalls[id] = call;
    });

    const metrics = getExecutiveMetrics(dayCalls, { snapshotDate: date });

    const reportingStatus = {
        status: 'Snapshot',
        started: `${date} 12:00 AM CT`,
        ended: `${date} 11:59 PM CT`
    };

    const html = buildExecutiveHtml(metrics, reportingStatus, teamMappings, userRoleOverrides, roster);

    fs.mkdirSync('snapshots', { recursive: true });
    fs.writeFileSync(`snapshots/daily_snapshot_${date}.html`, html);

    res.send(html);
});


// =============================================================================
// REPORTING CONTROLS
// =============================================================================

// Starts a new reporting session. Webhooks received before this point are ignored
// in report calculations, allowing clean session-based reporting windows.
app.get('/start-reporting', (req, res) => {
    reportingState.is_reporting = true;
    reportingState.started_at = Math.floor(Date.now() / 1000);
    reportingState.stopped_at = null;

    saveJson('reporting_state.json', reportingState);
    writeAllFiles();

    console.log('Reporting started.');
    res.redirect('/report');
});

// Stops the reporting session without killing the webhook listener.
// Aircall still receives 200 OK responses; events are just not recorded.
app.get('/stop-reporting', (req, res) => {
    reportingState.is_reporting = false;
    reportingState.stopped_at = Math.floor(Date.now() / 1000);

    saveJson('reporting_state.json', reportingState);
    writeAllFiles();

    console.log('Reporting stopped.');
    res.redirect('/report');
});

// Wipes all call and user status data and starts a fresh reporting session.
app.get('/reset', (req, res) => {
    Object.keys(calls).forEach(key => delete calls[key]);
    Object.keys(userStatusHistory).forEach(key => delete userStatusHistory[key]);

    reportingState.is_reporting = true;
    reportingState.started_at = Math.floor(Date.now() / 1000);
    reportingState.stopped_at = null;

    saveJson('calls.json', calls);
    saveJson('user_status_history.json', userStatusHistory);
    saveJson('reporting_state.json', reportingState);

    writeAllFiles();

    console.log('Datasets reset.');
    res.redirect('/report');
});


// =============================================================================
// BACKFILL
// Backfill exists because Aircall webhooks occasionally miss events — calls can
// be created, transferred, or ended without the webhook firing. The backfill
// pulls from the Aircall API directly to fill those gaps.
// =============================================================================

// Fetches a single call from the Aircall API and upserts it into calls[].
// Uses raw fetch (not aircallApi service) because the response wraps the call
// under data.call, which the generic aircallApi helper doesn't unwrap.
async function backfillCall(callId) {
    const response = await fetch(`https://api.aircall.io/v1/calls/${callId}`, {
        headers: {
            Authorization: `Basic ${Buffer.from(
                `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`
            ).toString('base64')}`,
            'Content-Type': 'application/json'
        }
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(JSON.stringify(data));
    }

    calls[callId] = calls[callId] || {};
    calls[callId].api_snapshots = calls[callId].api_snapshots || {};
    calls[callId].api_snapshots.v1_call = data;

    const apiCall = data.call;

    calls[callId].call_core = {
        call_id: apiCall.id,
        call_uuid: apiCall.sid,
        direction: apiCall.direction,
        caller_number: apiCall.raw_digits,
        called_number_name: apiCall.number?.name || null,
        called_number_digits: apiCall.number?.digits || null,
        result: apiCall.status === 'done' && apiCall.answered_at ? 'ANSWERED' : 'MISSED',
        status: apiCall.status,
        missed_call_reason: apiCall.missed_call_reason,
        started_at: apiCall.started_at,
        answered_at: apiCall.answered_at,
        ended_at: apiCall.ended_at,
        duration: apiCall.duration,
        answered_by_name: apiCall.user?.name || null,
        answered_by_email: apiCall.user?.email || null,
        team_names: apiCall.teams?.map(team => team.name) || []
    };

    calls[callId].derived_flags = {
        answered: Boolean(apiCall.answered_at),
        missed: !apiCall.answered_at,
        voicemail_left: Boolean(apiCall.voicemail),
        owner_answered: false,
        owner_unavailable: false,
        owner_skipped: false,
        answered_by_backup_agent: false,
        callback_after_miss: false,
        suspected_failed_answer: false
    };

    calls[callId].routing_analysis = calls[callId].routing_analysis || {
        did_owner_email: null,
        did_owner_status_at_call_time: null,
        rang_agents: [],
        declined_agents: [],
        answered_by: apiCall.user
            ? {
                id: apiCall.user.id,
                name: apiCall.user.name,
                email: apiCall.user.email,
                answered_at: apiCall.answered_at,
                answered_at_formatted: formatTime(apiCall.answered_at)
            }
            : null,
        why_owner_did_not_answer: 'Backfilled from Aircall API'
    };

    return calls[callId];
}

// Fetches all calls since the start of today's business day and upserts each one.
// Preserves existing webhook event history — only fills in what's missing.
async function backfillBusinessDayCalls() {
    const from = getTodayBusinessStartCentralUnix();
    const apiCalls = await fetchAllAircallPages(`/v1/calls?from=${from}`, 'calls');

    let inboundCount = 0;
    let outboundCount = 0;

    apiCalls.forEach(apiCall => {
        const callId = apiCall.id;
        if (!callId) return;

        const call = ensureCall(calls, callId, apiCall, numberOwners, userStatusHistory);
        if (!call) {
            console.log(`Could not create/find backfill call for callId: ${callId}`);
            return;
        }

        updateCallCore(call, apiCall);

        if (apiCall.user) {
            call.call_core.answered_by_name = apiCall.user.name || call.call_core.answered_by_name;
            call.call_core.answered_by_email = apiCall.user.email || call.call_core.answered_by_email;

            call.routing_analysis.answered_by = {
                id: apiCall.user.id || null,
                name: apiCall.user.name || null,
                email: apiCall.user.email || null,
                answered_at: apiCall.answered_at || null,
                answered_at_formatted: formatTime(apiCall.answered_at)
            };
        }

        call.api_snapshots.v1_call = apiCall;

        if (!call.webhook_events) call.webhook_events = [];
        const alreadyBackfilled = call.webhook_events.some(e =>
            e.event === 'api.backfill_business_day'
        );

        if (!alreadyBackfilled) {
            call.webhook_events.push({
                received_at: new Date().toISOString(),
                event: 'api.backfill_business_day',
                timestamp: Math.floor(Date.now() / 1000),
                payload: { source: 'aircall_api', api_call_id: callId }
            });
        }

        updateDerivedFlags(call);

        if (apiCall.direction === 'inbound') inboundCount += 1;
        else if (apiCall.direction === 'outbound') outboundCount += 1;
    });

    writeAllFiles();

    return { inboundCount, outboundCount, from };
}

app.get('/backfill-today', async (req, res) => {
    const result = await backfillBusinessDayCalls();
    reportingState.last_backfill = {
        ran_at: Math.floor(Date.now() / 1000),
        inbound_count: result.inboundCount,
        outbound_count: result.outboundCount
    };
    writeAllFiles();
    res.json({ success: true, inbound_count: result.inboundCount, outbound_count: result.outboundCount });
});

app.get('/backfill-call/:id', async (req, res) => {
    try {
        const call = await backfillCall(req.params.id);
        writeAllFiles();

        res.json({ success: true, call_id: req.params.id, call });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


// =============================================================================
// SYNC
// The scheduled sync is a safety net that runs every hour to catch any calls
// that webhooks missed entirely (not just incomplete data — full gaps).
// It only imports calls that don't exist in calls[] at all.
// =============================================================================

// Fetches the last 24 hours from Aircall and imports any calls not already tracked.
// Uses raw fetch with pagination because it needs next_page_link from meta,
// which the generic fetchAllAircallPages helper doesn't expose.
async function syncLast24HourCalls() {
    console.log('Starting Aircall recent-call sync...');

    const now = Math.floor(Date.now() / 1000);
    const since = now - (24 * 60 * 60);

    let url = `https://api.aircall.io/v1/calls?per_page=50&from=${since}&to=${now}&order=asc`;
    let allApiCalls = [];

    while (url) {
        const response = await fetch(url, {
            headers: {
                Authorization: `Basic ${Buffer.from(
                    `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`
                ).toString('base64')}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(JSON.stringify(data));
        }

        allApiCalls.push(...(data.calls || []));
        url = data.meta?.next_page_link || null;
    }

    console.log(`Fetched ${allApiCalls.length} calls`);

    const missing = allApiCalls.filter(apiCall =>
        ['inbound', 'outbound'].includes(apiCall.direction) &&
        !calls[String(apiCall.id)]
    );

    const beforeCount = Object.keys(calls).length;
    const backfilled = [];

    for (const apiCall of missing) {
        const id = String(apiCall.id);
        await backfillCall(id);
        backfilled.push(id);
        await sleep(AIRCALL_API_RATE_LIMIT_MS);
    }

    const afterCount = Object.keys(calls).length;

    return {
        checked_count: allApiCalls.length,
        missing_call_count: missing.length,
        backfilled_count: backfilled.length,
        call_count_before: beforeCount,
        call_count_after: afterCount,
        net_new_calls: afterCount - beforeCount,
        backfilled_call_ids: backfilled,
        first_call_id: allApiCalls[0]?.id,
        last_call_id: allApiCalls[allApiCalls.length - 1]?.id,
        from: since,
        to: now,
        checked_at: new Date().toISOString()
    };
}

app.get('/sync-last-24h', async (req, res) => {
    try {
        const result = await syncLast24HourCalls();
        writeAllFiles();
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Pulls current users and numbers from Aircall and saves to aircall_roster.json.
// The roster is used by reports to resolve team membership and DID ownership.
app.get('/sync-roster', async (req, res) => {
    const users = await fetchAllAircallPages('/v1/users', 'users');
    const numbers = await fetchAllAircallPages('/v1/numbers', 'numbers');

    const roster = {
        last_synced_at: Math.floor(Date.now() / 1000),
        last_synced_at_formatted: new Date().toLocaleString('en-US', {
            timeZone: TIMEZONE,
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
            timeZoneName: 'short'
        }),
        users,
        numbers,
        teams: []
    };

    saveJson('aircall_roster.json', roster);
    console.log(`Roster saved: ${users.length} users, ${numbers.length} numbers`);

    writeAllFiles();
    res.redirect('/report');
});


// =============================================================================
// DEBUG ROUTES
// These exist to investigate specific data questions and are not part of normal
// operations. They read from in-memory state so no writes happen here.
// =============================================================================

// Returns all calls where a given agent was rung or answered.
app.get('/debug-user-calls/:email', (req, res) => {
    const email = String(req.params.email || '').toLowerCase();

    const matches = Object.values(calls)
        .filter(call => {
            const core = call.call_core || {};
            const routing = call.routing_analysis || {};
            const rangAgents = routing.rang_agents || [];

            const rangThisUser = rangAgents.some(agent =>
                String(agent.email || '').toLowerCase() === email
            );

            const answeredByThisUser =
                String(core.answered_by_email || '').toLowerCase() === email;

            return rangThisUser || answeredByThisUser;
        })
        .map(call => {
            const core = call.call_core || {};
            const routing = call.routing_analysis || {};
            const rangAgents = routing.rang_agents || [];

            return {
                call_id: core.call_id,
                number: core.called_number_name,
                result: core.result,
                answered_by: core.answered_by_name,
                answered_by_email: core.answered_by_email,
                rang_agents_count: rangAgents.length,
                rang_agents: rangAgents.map(agent => ({ name: agent.name, email: agent.email })),
                source_reason: rangAgents.some(agent =>
                    String(agent.email || '').toLowerCase() === email
                )
                    ? 'rang_agent'
                    : 'answered_by_fallback'
            };
        });

    res.json({ email, count: matches.length, calls: matches });
});

// Returns today's calls matching a given agent from the computed metrics.
app.get('/debug-user/:email', (req, res) => {
    const email = req.params.email.toLowerCase();
    const metrics = getExecutiveMetrics(calls);

    const matchingCalls = [];

    metrics.inboundCalls.forEach(call => {
        const core = call.call_core || {};
        const routing = call.routing_analysis || {};

        const matched =
            core.answered_by_email?.toLowerCase() === email ||
            (routing.rang_agents || []).some(a =>
                String(a.email || '').toLowerCase() === email
            );

        if (matched) {
            matchingCalls.push({
                call_id: core.call_id,
                number: core.called_number_name,
                result: core.result,
                answered_by: core.answered_by_email
            });
        }
    });

    res.json(matchingCalls);
});

// Shows calls that were answered but had no rang_agents — these get attributed
// to the answering agent via fallback logic and this route confirms whether
// that fallback is being applied correctly in userDailyStats.
app.get('/debug-answer-fallback', (req, res) => {
    const metrics = getExecutiveMetrics(calls);

    const fallbackAnsweredCalls = Object.values(calls)
        .filter(call => {
            const core = call.call_core || {};
            const routing = call.routing_analysis || {};
            const rangAgents = routing.rang_agents || [];

            return (
                core.answered_by_email &&
                rangAgents.length === 0 &&
                call.derived_flags?.answered
            );
        })
        .map(call => {
            const core = call.call_core || {};
            const stats = metrics.userDailyStats[core.answered_by_email];

            return {
                call_id: core.call_id,
                number: core.called_number_name,
                answered_by: core.answered_by_name,
                answered_by_email: core.answered_by_email,
                counted_in_user_stats: Boolean(stats),
                user_total_rings: stats?.totalRings || 0,
                user_answered_calls: stats?.answeredCalls || 0
            };
        });

    res.json({ count: fallbackAnsweredCalls.length, calls: fallbackAnsweredCalls });
});

// Returns raw call records by comma-separated IDs for direct inspection.
app.get('/debug-calls/:ids', (req, res) => {
    const ids = String(req.params.ids || '').split(',');
    const results = {};

    ids.forEach(id => {
        results[id] = calls[id] || null;
    });

    res.json(results);
});

// Cross-checks teamMappings emails against the Aircall roster.
// Useful after roster sync to confirm everyone in config has an Aircall license.
app.get('/debug-team-mapping', (req, res) => {
    const roster = loadJson('aircall_roster.json', { users: [], numbers: [], teams: [] });

    const rosterEmails = new Set(
        (roster.users || [])
            .map(user => String(user.email || '').toLowerCase())
            .filter(Boolean)
    );

    const missing = [];

    teamMappings.forEach(team => {
        const emails = [
            team.manager,
            ...(team.supervisors || []),
            ...(team.users || [])
        ].filter(Boolean);

        emails.forEach(email => {
            const normalizedEmail = String(email).toLowerCase();
            if (!rosterEmails.has(normalizedEmail)) {
                missing.push({ team: team.team_name, email: normalizedEmail });
            }
        });
    });

    res.json({
        roster_user_count: roster.users.length,
        missing_count: missing.length,
        missing
    });
});

// Debug lookup — finds Aircall users matching a name or email substring.
// Usage: /find-aircall-user?name=jennifer  or  /find-aircall-user?email=ana
app.get('/find-aircall-user', async (req, res) => {
    const query = String(req.query.name || req.query.email || '').toLowerCase();

    if (!query) {
        return res.status(400).json({ error: 'Provide ?name= or ?email= to search' });
    }

    const users = await fetchAllAircallPages('/v1/users', 'users');

    const matches = users.filter(user =>
        String(user.name || '').toLowerCase().includes(query) ||
        String(user.email || '').toLowerCase().includes(query)
    );

    res.json(matches);
});


// =============================================================================
// SERVER STARTUP & SCHEDULED JOBS
// =============================================================================

app.listen(PORT, '0.0.0.0', () => {
    console.log('========================================');
    console.log('APPLICATION STARTED');
    console.log(`Server running on port ${PORT} — started ${new Date().toLocaleString()}`);
    console.log('========================================');
    
});

const SYNC_INTERVAL_MS = 60 * 60 * 1000;

setInterval(async () => {
    try {
        console.log('Running scheduled Aircall sync...');
        const result = await syncLast24HourCalls();
        writeAllFiles();
        console.log('Scheduled Aircall sync complete:', result);
    } catch (error) {
        console.error('Scheduled Aircall sync failed:', error.message);
    }
}, SYNC_INTERVAL_MS);
