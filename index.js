require('dotenv').config();

const express = require('express');
const path = require('path');

//location for aircall.js functions
const { aircallApi, fetchAllAircallPages } = require('./services/aircallApi');

//location for json load/save functions
const { loadJson, saveJson } = require('./storage/jsonStore');

//location of team mappings, data pulled from aircall api into aircall_roster, then teamMappings is the hard coded team structures
const { teamMappings, userRoleOverrides } = require('./config/teamMappings');

// functions for the report that output to executive html file
const {
    detectCallbacks,
    writeExecutiveReport,
    writeExecutiveHtmlReport,
    writeUsersHtmlReport,
    writeBackfillTestHtmlReport,
    writeExceptionsReport
} = require('./reports/reportFunctions');

const {
    ensureCall,
    updateCallCore,
    updateRoutingAnalysis,
    updateDerivedFlags,
    enrichCallFromApi,
    addUserStatusSnapshot
} = require('./logic/callProcessing');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

const calls = loadJson('calls.json', {});
const userStatusHistory = loadJson('user_status_history.json', {});

const reportingState = loadJson('reporting_state.json', {
    is_reporting: true,
    started_at: Math.floor(Date.now() / 1000),
    stopped_at: null
});

const numberOwners = {};

function formatTime(unixTimestamp) {
    if (!unixTimestamp) return 'unknown';

    return new Date(unixTimestamp * 1000).toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        dateStyle: 'short',
        timeStyle: 'medium'
    });
}

function getNumberDigits(data) {
    return data.number?.e164_digits || data.number?.digits || null;
}

function getTeamNames(data) {
    if (!data.teams || data.teams.length === 0) return [];
    return data.teams.map(team => team.name);
}

function getLatestUserStatus(email) {
    if (!email || !userStatusHistory[email]) return null;

    const history = userStatusHistory[email];
    return history[history.length - 1] || null;
}

function writeAllFiles() {
    detectCallbacks(calls);

    saveJson('calls.json', calls);
    saveJson('user_status_history.json', userStatusHistory);
    saveJson('reporting_state.json', reportingState);

    const roster = loadJson('aircall_roster.json', {
        users: [],
        numbers: [],
        teams: []
    });
    writeExecutiveReport(calls, reportingState);
    writeExecutiveHtmlReport(calls, reportingState, teamMappings, userRoleOverrides, roster);
    writeExceptionsReport(calls);
}

async function writeUsersFile() {
    const users = await fetchAllAircallPages('/v1/users', 'users');
    const numbers = await fetchAllAircallPages('/v1/numbers', 'numbers');

    console.log(`Total users fetched: ${users.length}`);
    console.log(`Total numbers fetched: ${numbers.length}`);

    writeUsersHtmlReport(users, numbers);
}

function getTodayBusinessStartCentralUnix() {
    const now = new Date();

    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now);

    const year = parts.find(part => part.type === 'year').value;
    const month = parts.find(part => part.type === 'month').value;
    const day = parts.find(part => part.type === 'day').value;

    const centralBusinessStart = new Date(`${year}-${month}-${day}T07:00:00-05:00`);

    return Math.floor(centralBusinessStart.getTime() / 1000);
}

async function backfillBusinessDayCalls() {
    const from = getTodayBusinessStartCentralUnix();
    const apiCalls = await fetchAllAircallPages(`/v1/calls?from=${from}`, 'calls');

    let importedCount = 0;

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

        const alreadyBackfilled = call.webhook_events.some(event =>
            event.event === 'api.backfill_business_day'
        );

        if (!alreadyBackfilled) {
            call.webhook_events.push({
                received_at: new Date().toISOString(),
                event: 'api.backfill_business_day',
                timestamp: Math.floor(Date.now() / 1000),
                payload: {
                    source: 'aircall_api',
                    api_call_id: callId
                }
            });
        }

        updateDerivedFlags(call);
        importedCount += 1;
    });

    writeAllFiles();

    return {
        importedCount,
        from
    };
}

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
        addUserStatusSnapshot(event, data, timestamp);
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

    if (data.user) {
        addUserStatusSnapshot(`snapshot_from_${event}`, data.user, timestamp);
    }

    updateRoutingAnalysis(call, event, data, timestamp);

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

app.get('/', (req, res) => {
    res.send('Aircall webhook server running. Open /report to view the dashboard.');
});

app.get('/report', (req, res) => {
    writeAllFiles();
    res.sendFile(path.join(__dirname, 'executive_report.html'));
});

app.get('/sync-roster', async (req, res) => {
    const users = await fetchAllAircallPages('/v1/users', 'users');
    const numbers = await fetchAllAircallPages('/v1/numbers', 'numbers');

    const now = Math.floor(Date.now() / 1000);

    const roster = {
        last_synced_at: now,
        last_synced_at_formatted: new Date().toLocaleString('en-US', {
            timeZone: 'America/Chicago',
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

app.get('/find-aircall-user', async (req, res) => {
    const users = await fetchAllAircallPages('/v1/users', 'users');

    const matches = users.filter(user =>
        String(user.name || '').toLowerCase().includes('jennifer') ||
        String(user.email || '').toLowerCase().includes('jennifer')
    );

    res.json(matches);
});

app.get('/users', async (req, res) => {
    await writeUsersFile();
    res.sendFile(path.join(__dirname, 'users_report.html'));
});

app.get('/backfill-test', async (req, res) => {
    await backfillBusinessDayCalls();
    writeBackfillTestHtmlReport(calls, reportingState);
    res.sendFile(path.join(__dirname, 'backfill_test_report.html'));
});

app.get('/start-reporting', (req, res) => {
    reportingState.is_reporting = true;
    reportingState.started_at = Math.floor(Date.now() / 1000);
    reportingState.stopped_at = null;

    saveJson('reporting_state.json', reportingState);
    writeAllFiles();

    console.log('Reporting started.');
    res.redirect('/report');
});

app.get('/stop-reporting', (req, res) => {
    reportingState.is_reporting = false;
    reportingState.stopped_at = Math.floor(Date.now() / 1000);

    saveJson('reporting_state.json', reportingState);
    writeAllFiles();

    console.log('Reporting stopped.');
    res.redirect('/report');
});

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

app.get('/calls-json', (req, res) => {
    res.sendFile(path.join(__dirname, 'calls.json'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

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
                rang_agents: rangAgents.map(agent => ({
                    name: agent.name,
                    email: agent.email
                })),
                source_reason: rangAgents.some(agent =>
                    String(agent.email || '').toLowerCase() === email
                )
                    ? 'rang_agent'
                    : 'answered_by_fallback'
            };
        });

    res.json({
        email,
        count: matches.length,
        calls: matches
    });
});

app.get('/debug-answer-fallback', (req, res) => {
    const { getExecutiveMetrics } = require('./reports/reportFunctions');
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

    res.json({
        count: fallbackAnsweredCalls.length,
        calls: fallbackAnsweredCalls
    });
});

app.get('/debug-calls/:ids', (req, res) => {
    const ids = String(req.params.ids || '').split(',');
    const results = {};

    ids.forEach(id => {
        results[id] = calls[id] || null;
    });

    res.json(results);
});

app.get('/backfill-call/:id', async (req, res) => {
    const callId = req.params.id;

    try {
        const response = await fetch(`https://api.aircall.io/v1/calls/${callId}`, {
            headers: {
                Authorization: `Basic ${Buffer.from(`${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`).toString('base64')}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
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
                    answered_at: apiCall.answered_at
                }
                : null,
            why_owner_did_not_answer: 'Backfilled from Aircall API'
        };

        writeAllFiles();

        res.json({
            success: true,
            call_id: callId,
            call: calls[callId]
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/debug-team-mapping', (req, res) => {
    const roster = loadJson('aircall_roster.json', {
        users: [],
        numbers: [],
        teams: []
    });

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
                missing.push({
                    team: team.team_name,
                    email: normalizedEmail
                });
            }
        });
    });

    res.json({
        roster_user_count: roster.users.length,
        missing_count: missing.length,
        missing
    });
});