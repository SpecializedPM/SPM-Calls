require('dotenv').config();

const express = require('express');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

const calls = {};
const userStatuses = {};

/*
  Add DID owner mappings here.
  Format:
  '+PHONE_NUMBER_E164': 'owner_email'
*/
const numberOwners = {
    '+18178869233': 'kyle@specialized247.com'
};

function formatTime(unixTimestamp) {
    if (!unixTimestamp) return null;
    return new Date(unixTimestamp * 1000).toLocaleString();
}

function getNumberDigits(data) {
    return data.number?.e164_digits || data.number?.digits || null;
}

function getTeamName(data) {
    if (data.teams && data.teams.length > 0) {
        return data.teams.map(team => team.name).join(', ');
    }
    return null;
}

function writeJsonFile(filename, data) {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
}

async function aircallApi(path) {
    if (!process.env.AIRCALL_API_ID || !process.env.AIRCALL_API_TOKEN) {
        console.log('Missing AIRCALL_API_ID or AIRCALL_API_TOKEN in .env');
        return null;
    }

    const auth = Buffer.from(
        `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`
    ).toString('base64');

    try {
        const response = await fetch(`https://api.aircall.io${path}`, {
            method: 'GET',
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.log(`Aircall API error ${response.status} for ${path}`);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.log(`Aircall API request failed for ${path}`, error.message);
        return null;
    }
}

async function getAircallCall(callId) {
    return await aircallApi(`/v1/calls/${callId}`);
}

function updateUserStatusFromWebhook(event, data, timestamp) {
    if (!data) return;

    const key = data.email || String(data.id);

    userStatuses[key] = {
        id: data.id,
        name: data.name,
        email: data.email || null,
        available: data.available,
        availability_status: data.availability_status,
        substatus: data.substatus,
        wrap_up_time: data.wrap_up_time,
        updated_at: timestamp,
        updated_at_formatted: formatTime(timestamp),
        source_event: event
    };
}

function attachNumberOwnerStatus(call) {
    const ownerEmail = numberOwners[call.latest_number_digits];

    call.number_owner_email = ownerEmail || null;
    call.number_owner_status_snapshot = ownerEmail
        ? userStatuses[ownerEmail] || null
        : null;
}

function isUserBusy(userEmail, ringTimestamp, currentCallId) {
    if (!userEmail || !ringTimestamp) return false;

    return Object.values(calls).some(call => {
        if (String(call.call_id) === String(currentCallId)) return false;
        if (!call.answered_by_email) return false;
        if (call.answered_by_email !== userEmail) return false;
        if (!call.answered_at) return false;

        const callStart = call.answered_at;
        const callEnd = call.ended_at || Math.floor(Date.now() / 1000);

        return ringTimestamp >= callStart && ringTimestamp <= callEnd;
    });
}

function determineMissedReason(call) {
    if (call.result !== 'MISSED') return 'none';

    if (call.missed_call_reason) {
        const busyAgents = call.rang_agents.filter(agent => agent.busy_when_rang);

        if (call.missed_call_reason === 'agents_did_not_answer' && busyAgents.length > 0) {
            return `agents_did_not_answer; possible busy agents: ${busyAgents.map(a => a.name).join(', ')}`;
        }

        return call.missed_call_reason;
    }

    if (call.rang_agents.length === 0) {
        return 'no_agent_rang';
    }

    return 'missed_unknown_reason';
}

function getOwnerDisplayName(call) {
    const status = call.number_owner_status_snapshot;
    if (status?.name) return status.name;

    if (call.number_owner_email) return call.number_owner_email;

    return 'unknown';
}

function getOwnerAvailabilityText(call) {
    const status = call.number_owner_status_snapshot;

    if (!status) return 'unknown';

    return `available=${status.available}, status=${status.availability_status || 'unknown'}, substatus=${status.substatus || 'unknown'}`;
}

function getWhyNotOwner(call) {
    if (!call.number_owner_email) return 'No DID owner mapping found';
    if (!call.number_owner_status_snapshot) return 'No owner status snapshot available';

    const status = call.number_owner_status_snapshot;

    if (call.answered_by_email === call.number_owner_email) {
        return 'DID owner answered';
    }

    if (status.available === false) {
        return `DID owner unavailable: ${status.availability_status || 'unknown'} / ${status.substatus || 'unknown'}`;
    }

    if (status.availability_status && status.availability_status !== 'available') {
        return `DID owner not available: ${status.availability_status} / ${status.substatus || 'unknown'}`;
    }

    if (call.rang_agents.some(agent => agent.email === call.number_owner_email)) {
        return 'DID owner was rung but did not answer';
    }

    return 'DID owner was not rung; exact reason not shown in call payload';
}

function findCallbacksForMissedCall(missedCall) {
    if (missedCall.result !== 'MISSED') return [];

    const missedEnd = missedCall.ended_at || missedCall.started_at;
    if (!missedEnd) return [];

    return Object.values(calls)
        .filter(call => {
            if (String(call.call_id) === String(missedCall.call_id)) return false;
            if (call.caller_number !== missedCall.caller_number) return false;
            if (!call.started_at) return false;
            if (call.started_at <= missedEnd) return false;

            const secondsAfter = call.started_at - missedEnd;
            return secondsAfter <= 600;
        })
        .sort((a, b) => a.started_at - b.started_at)
        .map(call => ({
            call_id: call.call_id,
            seconds_after: call.started_at - missedEnd,
            result: call.result,
            answered_by: call.answered_by,
            started_at: call.started_at
        }));
}

function detectExceptions() {
    const exceptions = [];

    Object.values(calls).forEach(call => {
        const ownerEmail = call.number_owner_email;
        const ownerStatus = call.number_owner_status_snapshot;

        if (
            ownerEmail &&
            ownerStatus &&
            call.result === 'ANSWERED' &&
            call.answered_by_email &&
            call.answered_by_email !== ownerEmail
        ) {
            exceptions.push({
                type: 'DID owner unavailable or bypassed; another agent answered',
                call_id: call.call_id,
                caller: call.caller_number,
                called_number: `${call.latest_number_name} (${call.latest_number_digits})`,
                did_owner: getOwnerDisplayName(call),
                owner_status: getOwnerAvailabilityText(call),
                answered_by: call.answered_by,
                why: getWhyNotOwner(call),
                started_at: call.started_at
            });
        }

        if (call.result === 'MISSED') {
            const callbacks = findCallbacksForMissedCall(call);

            if (callbacks.length > 0) {
                exceptions.push({
                    type: 'Caller called back after missed call',
                    missed_call_id: call.call_id,
                    caller: call.caller_number,
                    missed_reason: determineMissedReason(call),
                    callback_call_id: callbacks[0].call_id,
                    callback_result: callbacks[0].result,
                    callback_answered_by: callbacks[0].answered_by,
                    seconds_until_callback: callbacks[0].seconds_after,
                    started_at: call.started_at
                });
            }
        }

        if (
            call.result === 'MISSED' &&
            call.rang_agents.length > 0 &&
            !call.events.includes('call.answered') &&
            call.rang_agents.some(agent => !call.event_history.some(e =>
                e.event === 'call.agent_declined' &&
                e.payload?.data?.user?.email === agent.email
            ))
        ) {
            exceptions.push({
                type: 'Possible failed answer attempt or unanswered ring',
                call_id: call.call_id,
                caller: call.caller_number,
                called_number: `${call.latest_number_name} (${call.latest_number_digits})`,
                rang_agents: call.rang_agents.map(a => a.name).join(', '),
                missed_reason: determineMissedReason(call),
                why: 'One or more agents were rung, no answer event was recorded, and not every rung agent declined.',
                started_at: call.started_at
            });
        }

        if (
            ownerEmail &&
            !call.rang_agents.some(agent => agent.email === ownerEmail) &&
            call.answered_by_email !== ownerEmail
        ) {
            exceptions.push({
                type: 'DID owner was not rung',
                call_id: call.call_id,
                caller: call.caller_number,
                called_number: `${call.latest_number_name} (${call.latest_number_digits})`,
                did_owner: getOwnerDisplayName(call),
                owner_status: getOwnerAvailabilityText(call),
                answered_by: call.answered_by || 'none',
                result: call.result,
                why: getWhyNotOwner(call),
                started_at: call.started_at
            });
        }
    });

    return exceptions;
}

function rebuildUserReport() {
    const users = {};

    function ensureUser(name, email) {
        const key = email || name;

        if (!users[key]) {
            users[key] = {
                user_name: name,
                user_email: email || null,
                latest_status: userStatuses[email] || null,
                answered_calls: [],
                answered_someone_else_did: [],
                owned_did_calls: [],
                owned_did_routed_away: [],
                rang_then_answered: [],
                rang_someone_else_answered: [],
                rang_call_missed: []
            };
        }

        return users[key];
    }

    Object.values(calls).forEach(call => {
        if (call.number_owner_email) {
            const ownerStatus = call.number_owner_status_snapshot;
            const ownerName = ownerStatus?.name || call.number_owner_email;
            const owner = ensureUser(ownerName, call.number_owner_email);

            const ownedRecord = {
                call_id: call.call_id,
                caller: call.caller_number,
                number_name: call.latest_number_name,
                number_digits: call.latest_number_digits,
                result: call.result,
                answered_by: call.answered_by,
                owner_status: getOwnerAvailabilityText(call),
                why_not_owner: getWhyNotOwner(call),
                started_at: call.started_at
            };

            owner.owned_did_calls.push(ownedRecord);

            if (call.answered_by_email && call.answered_by_email !== call.number_owner_email) {
                owner.owned_did_routed_away.push(ownedRecord);
            }
        }

        if (call.answered_by) {
            const user = ensureUser(call.answered_by, call.answered_by_email);

            const answeredRecord = {
                call_id: call.call_id,
                caller: call.caller_number,
                number_name: call.latest_number_name,
                number_digits: call.latest_number_digits,
                team: call.team_name,
                started_at: call.started_at,
                answered_at: call.answered_at,
                ended_at: call.ended_at,
                duration: call.duration,
                result: call.result,
                did_owner_email: call.number_owner_email,
                did_owner_name: getOwnerDisplayName(call)
            };

            user.answered_calls.push(answeredRecord);

            if (call.number_owner_email && call.number_owner_email !== call.answered_by_email) {
                user.answered_someone_else_did.push(answeredRecord);
            }
        }

        call.rang_agents.forEach(agent => {
            const user = ensureUser(agent.name, agent.email);

            const agentAnsweredThisCall =
                call.answered_by_email &&
                agent.email &&
                call.answered_by_email === agent.email;

            const ringRecord = {
                call_id: call.call_id,
                caller: call.caller_number,
                number_name: call.latest_number_name,
                number_digits: call.latest_number_digits,
                team: call.team_name,
                ring_time: agent.ring_time,
                answered_by: call.answered_by,
                result: call.result,
                missed_reason: determineMissedReason(call),
                busy_when_rang: agent.busy_when_rang,
                availability_status: agent.availability_status,
                substatus: agent.substatus
            };

            if (agentAnsweredThisCall) {
                user.rang_then_answered.push(ringRecord);
            } else if (call.result === 'ANSWERED') {
                user.rang_someone_else_answered.push(ringRecord);
            } else if (call.result === 'MISSED') {
                user.rang_call_missed.push(ringRecord);
            }
        });
    });

    return users;
}

function writeExecutiveReport() {
    const allCalls = Object.values(calls);
    const answered = allCalls.filter(c => c.result === 'ANSWERED');
    const missed = allCalls.filter(c => c.result === 'MISSED');
    const exceptions = detectExceptions();

    let output = '';

    output += `EXECUTIVE CALL REPORT\n`;
    output += `Generated: ${new Date().toLocaleString()}\n\n`;

    output += `TOTALS\n`;
    output += `Total calls tracked: ${allCalls.length}\n`;
    output += `Answered calls: ${answered.length}\n`;
    output += `Missed calls: ${missed.length}\n`;
    output += `Exceptions / review items: ${exceptions.length}\n\n`;

    output += `CALLS BY RESULT\n`;
    allCalls
        .sort((a, b) => (a.started_at || 0) - (b.started_at || 0))
        .forEach(call => {
            output += `- Call ${call.call_id} | ${call.result} | ${call.latest_number_name} (${call.latest_number_digits}) | Caller: ${call.caller_number} | Answered by: ${call.answered_by || 'none'} | Owner: ${getOwnerDisplayName(call)} | Owner status: ${getOwnerAvailabilityText(call)}\n`;
        });

    output += `\nTOP EXCEPTIONS\n`;
    if (exceptions.length === 0) {
        output += `none\n`;
    } else {
        exceptions.forEach((item, index) => {
            output += `${index + 1}. ${item.type}\n`;
            output += `   Call: ${item.call_id || item.missed_call_id}\n`;
            output += `   Caller: ${item.caller || 'unknown'}\n`;
            output += `   Why: ${item.why || item.missed_reason || 'n/a'}\n`;
            if (item.answered_by) output += `   Answered by: ${item.answered_by}\n`;
            if (item.callback_call_id) output += `   Callback: ${item.callback_call_id}, answered by ${item.callback_answered_by || 'none'} after ${item.seconds_until_callback}s\n`;
        });
    }

    fs.writeFileSync('executive_call_report.txt', output);
}

function writeExceptionsReport() {
    const exceptions = detectExceptions();

    let output = '';

    output += `EXCEPTIONS REPORT\n`;
    output += `Generated: ${new Date().toLocaleString()}\n\n`;

    if (exceptions.length === 0) {
        output += `No exceptions detected.\n`;
    } else {
        exceptions.forEach((item, index) => {
            output += `${index + 1}. ${item.type}\n`;

            Object.entries(item).forEach(([key, value]) => {
                if (key === 'type') return;
                output += `   ${key}: ${value}\n`;
            });

            output += `\n`;
        });
    }

    fs.writeFileSync('exceptions_report.txt', output);
    writeJsonFile('exceptions_report.json', exceptions);
}

function writeCallSummariesFile() {
    let output = '';

    Object.values(calls)
        .sort((a, b) => (a.started_at || 0) - (b.started_at || 0))
        .forEach(call => {
            output += `CALL ID: ${call.call_id}\n`;
            output += `Caller: ${call.caller_number || 'unknown'}\n`;
            output += `Called number: ${call.latest_number_name || 'unknown'} (${call.latest_number_digits || 'unknown number'})\n`;
            output += `Started on: ${call.started_number_name || 'unknown'} (${call.started_number_digits || 'unknown number'})\n`;
            output += `Direction: ${call.direction || 'unknown'}\n`;
            output += `Result: ${call.result}\n`;
            output += `Missed reason: ${determineMissedReason(call)}\n`;
            output += `Answered by: ${call.answered_by || 'none'}\n`;
            output += `Team: ${call.team_name || 'none'}\n`;
            output += `DID owner: ${getOwnerDisplayName(call)}\n`;
            output += `DID owner email: ${call.number_owner_email || 'unknown'}\n`;
            output += `DID owner status at call time: ${getOwnerAvailabilityText(call)}\n`;
            output += `Why not DID owner: ${getWhyNotOwner(call)}\n`;
            output += `Rang agents: ${
                call.rang_agents.length > 0
                    ? call.rang_agents.map(a =>
                        `${a.name} (${a.availability_status || 'unknown'} / ${a.substatus || 'unknown'})`
                    ).join(', ')
                    : 'none'
            }\n`;
            output += `Started at: ${formatTime(call.started_at)}\n`;
            output += `Answered at: ${formatTime(call.answered_at)}\n`;
            output += `Ended at: ${formatTime(call.ended_at)}\n`;
            output += `Duration: ${call.duration || 0} seconds\n`;
            output += `Events: ${call.events.join(' -> ')}\n`;
            output += `API enriched: ${call.api_v1_call_snapshot ? 'yes' : 'no'}\n`;
            output += `\n====================\n\n`;
        });

    fs.writeFileSync('call_summaries.txt', output);
}

function writeUserReports() {
    const users = rebuildUserReport();

    writeJsonFile('user_call_report.json', users);

    let output = '';

    Object.values(users).forEach(user => {
        output += `USER: ${user.user_name}\n`;
        output += `Email: ${user.user_email || 'unknown'}\n`;

        if (user.latest_status) {
            output += `Latest status: available=${user.latest_status.available}, status=${user.latest_status.availability_status}, substatus=${user.latest_status.substatus}\n`;
        } else {
            output += `Latest status: unknown\n`;
        }

        output += `Answered calls: ${user.answered_calls.length}\n`;
        output += `Answered someone else's DID: ${user.answered_someone_else_did.length}\n`;
        output += `Owned DID calls: ${user.owned_did_calls.length}\n`;
        output += `Owned DID routed away: ${user.owned_did_routed_away.length}\n`;
        output += `Rang then answered: ${user.rang_then_answered.length}\n`;
        output += `Rang but someone else answered: ${user.rang_someone_else_answered.length}\n`;
        output += `Rang and call was missed: ${user.rang_call_missed.length}\n\n`;

        output += `ANSWERED CALLS\n`;
        if (user.answered_calls.length === 0) {
            output += `none\n`;
        } else {
            user.answered_calls.forEach(call => {
                output += `- Call ${call.call_id} | ${call.number_name} (${call.number_digits}) | Caller: ${call.caller} | Duration: ${call.duration || 0}s | Answered: ${formatTime(call.answered_at)}\n`;
            });
        }

        output += `\nANSWERED SOMEONE ELSE'S DID\n`;
        if (user.answered_someone_else_did.length === 0) {
            output += `none\n`;
        } else {
            user.answered_someone_else_did.forEach(call => {
                output += `- Call ${call.call_id} | DID owner: ${call.did_owner_name} (${call.did_owner_email}) | Caller: ${call.caller}\n`;
            });
        }

        output += `\nOWNED DID ROUTED AWAY\n`;
        if (user.owned_did_routed_away.length === 0) {
            output += `none\n`;
        } else {
            user.owned_did_routed_away.forEach(call => {
                output += `- Call ${call.call_id} | Answered by: ${call.answered_by || 'none'} | Owner status: ${call.owner_status} | Why: ${call.why_not_owner}\n`;
            });
        }

        output += `\nRANG THEN ANSWERED\n`;
        if (user.rang_then_answered.length === 0) {
            output += `none\n`;
        } else {
            user.rang_then_answered.forEach(call => {
                output += `- Call ${call.call_id} | ${call.number_name} (${call.number_digits}) | Status when rang: ${call.availability_status}/${call.substatus} | Rang: ${formatTime(call.ring_time)}\n`;
            });
        }

        output += `\nRANG BUT SOMEONE ELSE ANSWERED\n`;
        if (user.rang_someone_else_answered.length === 0) {
            output += `none\n`;
        } else {
            user.rang_someone_else_answered.forEach(call => {
                output += `- Call ${call.call_id} | ${call.number_name} (${call.number_digits}) | Answered by: ${call.answered_by || 'unknown'} | Status when rang: ${call.availability_status}/${call.substatus} | Rang: ${formatTime(call.ring_time)}\n`;
            });
        }

        output += `\nRANG AND CALL WAS MISSED\n`;
        if (user.rang_call_missed.length === 0) {
            output += `none\n`;
        } else {
            user.rang_call_missed.forEach(call => {
                output += `- Call ${call.call_id} | ${call.number_name} (${call.number_digits}) | Reason: ${call.missed_reason} | Status when rang: ${call.availability_status}/${call.substatus} | Rang: ${formatTime(call.ring_time)}\n`;
            });
        }

        output += `\n====================\n\n`;
    });

    fs.writeFileSync('user_call_report.txt', output);
}

function writeAllFiles() {
    writeCallSummariesFile();
    writeJsonFile('call_details.json', calls);
    writeJsonFile('user_statuses.json', userStatuses);
    writeUserReports();
    writeExecutiveReport();
    writeExceptionsReport();
}

app.post('/webhooks/aircall', async (req, res) => {
    const event = req.body.event;
    const resource = req.body.resource;
    const data = req.body.data || {};

    fs.appendFileSync(
        'payloads.txt',
        JSON.stringify(req.body, null, 2) + '\n\n====================\n\n'
    );

    if (resource === 'user') {
        updateUserStatusFromWebhook(event, data, req.body.timestamp);
        writeAllFiles();

        console.log(
            `USER STATUS | ${data.name} | available=${data.available} | ${data.availability_status} | ${data.substatus}`
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

    if (!calls[callId]) {
        calls[callId] = {
            call_id: callId,
            call_uuid: data.call_uuid || null,
            caller_number: data.raw_digits || null,
            direction: data.direction || null,

            started_number_name: data.number?.name || null,
            started_number_digits: getNumberDigits(data),

            latest_number_name: data.number?.name || null,
            latest_number_digits: getNumberDigits(data),

            number_owner_email: null,
            number_owner_status_snapshot: null,

            answered_by: null,
            answered_by_email: null,
            rang_agents: [],

            team_name: getTeamName(data),
            status: data.status || null,
            missed_call_reason: data.missed_call_reason || null,

            started_at: data.started_at || null,
            answered_at: data.answered_at || null,
            ended_at: data.ended_at || null,
            duration: data.duration || null,

            result: 'IN PROGRESS',
            events: [],

            api_v1_call_snapshot: null,
            latest_snapshot: null,
            event_history: []
        };
    }

    const call = calls[callId];

    call.event_history.push({
        received_at: new Date().toISOString(),
        event,
        resource,
        aircall_timestamp: req.body.timestamp || null,
        payload: req.body
    });

    call.latest_snapshot = data;

    if (!call.events.includes(event)) {
        call.events.push(event);
    }

    if (data.raw_digits) call.caller_number = data.raw_digits;
    if (data.direction) call.direction = data.direction;
    if (data.status) call.status = data.status;

    if (data.number?.name) call.latest_number_name = data.number.name;
    if (getNumberDigits(data)) call.latest_number_digits = getNumberDigits(data);

    attachNumberOwnerStatus(call);

    if (event === 'call.created' || event === 'call.answered' || event === 'call.ended') {
        const apiCall = await getAircallCall(callId);
        if (apiCall) {
            call.api_v1_call_snapshot = apiCall;
        }
    }

    if (data.missed_call_reason) call.missed_call_reason = data.missed_call_reason;

    if (data.started_at) call.started_at = data.started_at;
    if (data.answered_at) call.answered_at = data.answered_at;
    if (data.ended_at) call.ended_at = data.ended_at;
    if (data.duration) call.duration = data.duration;

    const teamName = getTeamName(data);
    if (teamName) call.team_name = teamName;

    if (data.user?.name) {
        updateUserStatusFromWebhook(
            `snapshot_from_${event}`,
            data.user,
            req.body.timestamp || Math.floor(Date.now() / 1000)
        );

        if (event === 'call.answered' || data.answered_at) {
            call.answered_by = data.user.name;
            call.answered_by_email = data.user.email || null;
        } else if (event === 'call.ringing_on_agent') {
            const ringTime = req.body.timestamp || data.started_at || Math.floor(Date.now() / 1000);
            const userEmail = data.user.email || null;

            const existingAgent = call.rang_agents.find(agent =>
                agent.name === data.user.name || agent.email === userEmail
            );

            const agentInfo = {
                id: data.user.id || null,
                name: data.user.name,
                email: userEmail,
                ring_time: ringTime,
                ring_time_formatted: formatTime(ringTime),
                available: data.user.available,
                availability_status: data.user.availability_status || null,
                substatus: data.user.substatus || null,
                wrap_up_time: data.user.wrap_up_time,
                busy_when_rang: isUserBusy(userEmail, ringTime, callId)
            };

            if (!existingAgent) {
                call.rang_agents.push(agentInfo);
            } else {
                Object.assign(existingAgent, agentInfo);
            }
        }
    }

    attachNumberOwnerStatus(call);

    if (call.missed_call_reason) {
        call.result = 'MISSED';
        call.answered_by = null;
        call.answered_by_email = null;
    } else if (call.answered_at || call.answered_by) {
        call.result = 'ANSWERED';
    } else if (call.ended_at || event === 'call.ended' || event === 'call.hungup') {
        call.result = 'MISSED';
    }

    console.log(
        `CALL ${callId} | ${event} | ${call.latest_number_name} | ${call.result}`
    );

    writeAllFiles();

    res.sendStatus(200);
});

app.get('/', (req, res) => {
    res.send('Webhook server running');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});55