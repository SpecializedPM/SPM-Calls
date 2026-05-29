function formatTime(unixTimestamp) {
    if (!unixTimestamp) return 'unknown';

    return new Date(unixTimestamp * 1000).toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        dateStyle: 'short',
        timeStyle: 'medium'
    });
}

function getNumberDigits(data = {}) {
    return data.number?.e164_digits || data.number?.digits || null;
}

function getTeamNames(data = {}) {
    if (!data.teams || data.teams.length === 0) return [];
    return data.teams.map(team => team.name);
}

function getLatestUserStatus(email, userStatusHistory = {}) {
    if (!email || !userStatusHistory[email]) return null;

    const history = userStatusHistory[email];
    return history[history.length - 1] || null;
}

function addUserStatusSnapshot(userStatusHistory = {}, event, user = {}, timestamp) {
    if (!user || !user.email) return;

    if (!userStatusHistory[user.email]) {
        userStatusHistory[user.email] = [];
    }

    userStatusHistory[user.email].push({
        captured_at: timestamp || Math.floor(Date.now() / 1000),
        captured_at_formatted: formatTime(timestamp),
        source_event: event,
        id: user.id || null,
        name: user.name || null,
        email: user.email || null,
        available: user.available,
        availability_status: user.availability_status || null,
        substatus: user.substatus || null,
        wrap_up_time: user.wrap_up_time ?? null
    });
}

function ensureCall(calls = {}, callId, data = {}, numberOwners = {}, userStatusHistory = {}) {
    if (!callId) return null;

    if (!calls[callId]) {
        const calledNumber = getNumberDigits(data);
        const ownerEmail = numberOwners[calledNumber] || null;

        calls[callId] = {
            call_core: {
                call_id: callId,
                call_uuid: data.call_uuid || null,
                direction: data.direction || null,
                caller_number: data.raw_digits || data.from || null,
                called_number_name: data.number?.name || null,
                called_number_digits: calledNumber,
                result: 'IN_PROGRESS',
                status: data.status || null,
                missed_call_reason: data.missed_call_reason || null,
                started_at: data.started_at || null,
                answered_at: data.answered_at || null,
                ended_at: data.ended_at || null,
                duration: data.duration || 0,
                answered_by_name: null,
                answered_by_email: null,
                team_names: getTeamNames(data)
            },

            webhook_events: [],

            api_snapshots: {
                v1_call: null,
                v1_number: null,
                v1_contact: null,
                v1_answered_user: null
            },

            routing_analysis: {
                did_owner_email: ownerEmail,
                did_owner_status_at_call_time: ownerEmail
                    ? getLatestUserStatus(ownerEmail, userStatusHistory)
                    : null,
                rang_agents: [],
                declined_agents: [],
                answered_by: null,
                why_owner_did_not_answer: 'No DID owner mapping configured'
            },

            derived_flags: {
                answered: false,
                missed: false,
                voicemail_left: false,
                owner_answered: false,
                owner_unavailable: false,
                owner_skipped: false,
                answered_by_backup_agent: false,
                callback_after_miss: false,
                suspected_failed_answer: false
            }
        };
    }

    return calls[callId];
}

function updateCallCore(call, data = {}) {
    if (!call || !call.call_core) return;

    const core = call.call_core;

    if (data.raw_digits) core.caller_number = data.raw_digits;
    if (data.from && !core.caller_number) core.caller_number = data.from;

    if (data.direction) core.direction = data.direction;
    if (data.status) core.status = data.status;
    if (data.missed_call_reason) core.missed_call_reason = data.missed_call_reason;

    if (data.started_at) core.started_at = data.started_at;
    if (data.answered_at) core.answered_at = data.answered_at;
    if (data.ended_at) core.ended_at = data.ended_at;

    if (data.duration !== undefined) core.duration = data.duration;

    if (data.number) {
        core.called_number_name = data.number.name || core.called_number_name;
        core.called_number_digits = getNumberDigits(data) || core.called_number_digits;
    }

    if (data.user && data.answered_at) {
        core.answered_by_name = data.user.name || core.answered_by_name;
        core.answered_by_email = data.user.email || core.answered_by_email;
    }

    const teams = getTeamNames(data);
    if (teams.length > 0) core.team_names = teams;
}

function updateRoutingAnalysis(
    call,
    event,
    data = {},
    timestamp,
    numberOwners = {},
    userStatusHistory = {}
) {
    if (!call || !call.call_core || !call.routing_analysis) return;

    const routing = call.routing_analysis;
    const core = call.call_core;

    const ownerEmail =
        numberOwners[core.called_number_digits] ||
        routing.did_owner_email ||
        null;

    routing.did_owner_email = ownerEmail;

    routing.did_owner_status_at_call_time = ownerEmail
        ? routing.did_owner_status_at_call_time ||
          getLatestUserStatus(ownerEmail, userStatusHistory)
        : null;

    if (event === 'call.ringing_on_agent' && data.user) {
        const agent = {
            id: data.user.id || null,
            name: data.user.name || null,
            email: data.user.email || null,
            ring_time: timestamp || data.started_at || null,
            ring_time_formatted: formatTime(timestamp || data.started_at),
            available: data.user.available,
            availability_status: data.user.availability_status || null,
            substatus: data.user.substatus || null,
            wrap_up_time: data.user.wrap_up_time ?? null
        };

        const exists = routing.rang_agents.some(existing =>
            existing.email === agent.email || existing.id === agent.id
        );

        if (!exists) routing.rang_agents.push(agent);
    }

    if (event === 'call.agent_declined' && data.user) {
        const declined = {
            id: data.user.id || null,
            name: data.user.name || null,
            email: data.user.email || null,
            declined_at: timestamp || null,
            declined_at_formatted: formatTime(timestamp)
        };

        const exists = routing.declined_agents.some(existing =>
            existing.email === declined.email || existing.id === declined.id
        );

        if (!exists) routing.declined_agents.push(declined);
    }

    if ((event === 'call.answered' || data.answered_at) && data.user) {
        core.answered_by_name = data.user.name || null;
        core.answered_by_email = data.user.email || null;

        routing.answered_by = {
            id: data.user.id || null,
            name: data.user.name || null,
            email: data.user.email || null,
            answered_at: data.answered_at || timestamp || null,
            answered_at_formatted: formatTime(data.answered_at || timestamp)
        };
    }
}

function updateDerivedFlags(call) {
    if (!call || !call.call_core || !call.routing_analysis || !call.derived_flags) return;

    const core = call.call_core;
    const routing = call.routing_analysis;
    const flags = call.derived_flags;

    flags.answered = Boolean(core.answered_at);
    
    flags.missed = Boolean(
        core.missed_call_reason ||
        (!flags.answered && core.ended_at)
    );

    flags.voicemail_left = Array.isArray(call.webhook_events)
        ? call.webhook_events.some(e => e.event === 'call.voicemail_left')
        : false;

    core.result = flags.answered
        ? 'ANSWERED'
        : flags.missed
            ? 'MISSED'
            : 'IN_PROGRESS';

    const ownerEmail = routing.did_owner_email;
    const ownerStatus = routing.did_owner_status_at_call_time;

    flags.owner_answered = Boolean(
        ownerEmail &&
        core.answered_by_email === ownerEmail
    );

    flags.owner_unavailable = Boolean(
        ownerStatus &&
        (
            ownerStatus.available === false ||
            (
                ownerStatus.availability_status &&
                ownerStatus.availability_status !== 'available'
            )
        )
    );

    flags.owner_skipped = Boolean(
        ownerEmail &&
        !routing.rang_agents.some(agent => agent.email === ownerEmail) &&
        core.answered_by_email !== ownerEmail
    );

    flags.answered_by_backup_agent = Boolean(
        flags.answered &&
        ownerEmail &&
        core.answered_by_email &&
        core.answered_by_email !== ownerEmail
    );

    flags.suspected_failed_answer = Boolean(
        flags.missed &&
        routing.rang_agents.length > 0 &&
        !call.webhook_events.some(e => e.event === 'call.answered') &&
        routing.rang_agents.some(agent =>
            !routing.declined_agents.some(declined =>
                declined.email === agent.email
            )
        )
    );
}

async function enrichCallFromApi(call, data = {}, aircallApi) {
    if (!call || !call.call_core || !aircallApi) return;

    const callId = call.call_core.call_id;

    const v1Call = await aircallApi(`/v1/calls/${callId}`);
    if (v1Call) call.api_snapshots.v1_call = v1Call;

    const numberId = data.number?.id;
    if (numberId) {
        const v1Number = await aircallApi(`/v1/numbers/${numberId}`);
        if (v1Number) call.api_snapshots.v1_number = v1Number;
    }

    const contactId = data.contact?.id;
    if (contactId) {
        const v1Contact = await aircallApi(`/v1/contacts/${contactId}`);
        if (v1Contact) call.api_snapshots.v1_contact = v1Contact;
    }

    const answeredUserId = data.user?.id;
    if (answeredUserId && (data.answered_at || call.call_core.answered_by_email)) {
        const v1User = await aircallApi(`/v1/users/${answeredUserId}`);
        if (v1User) call.api_snapshots.v1_answered_user = v1User;
    }
}

module.exports = {
    formatTime,
    getNumberDigits,
    getTeamNames,
    getLatestUserStatus,
    addUserStatusSnapshot,
    ensureCall,
    updateCallCore,
    updateRoutingAnalysis,
    updateDerivedFlags,
    enrichCallFromApi
};