const fs = require('fs');
const path = require('path');

function loadRoster() {
    const filePath = path.join(__dirname, '..', 'aircall_roster.json');

    if (!fs.existsSync(filePath)) {
        return { users: [], numbers: [], teams: [] };
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const { buildExecutiveHtml } = require('./executiveHtml');
const { buildUsersHtml } = require('./usersHtml');
const { buildBackfillTestHtml } = require('./backfillHtml');

const OUTPUT_DIR = path.join(__dirname, '..');

function formatCentralTime(value) {
    if (!value) return 'N/A';

    return new Date(value).toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZoneName: 'short'
    });
}

function writeOutputFile(filename, content) {
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), content);
}

function formatTime(unixTimestamp) {
    if (!unixTimestamp) return 'unknown';

    return new Date(unixTimestamp * 1000).toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZoneName: 'short'
    });
}

function getReportingStatusText(reportingState) {
    if (!reportingState) {
        return {
            status: 'Unknown',
            started: 'unknown',
            ended: 'unknown'
        };
    }

    return {
        status: reportingState.is_reporting ? 'Reporting' : 'Not Reporting',
        started: formatTime(reportingState.started_at),
        ended: reportingState.stopped_at ? formatTime(reportingState.stopped_at) : 'N/A'
    };
}

function isBusyStatus(agent = {}) {
    const statusText = [
        agent.availability_status,
        agent.substatus,
        agent.status
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return (
        statusText.includes('busy') ||
        statusText.includes('call') ||
        statusText.includes('phone') ||
        statusText.includes('wrap') ||
        statusText.includes('after_call') ||
        statusText.includes('in_call')
    );
}

function isAvailableStatus(agent = {}) {
    const statusText = [
        agent.availability_status,
        agent.substatus,
        agent.status
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return agent.available === true || statusText.includes('available');
}

function detectCallbacks(calls) {
    const allCalls = Object.values(calls);

    allCalls.forEach(call => {
        if (!call.derived_flags) call.derived_flags = {};
        call.derived_flags.callback_after_miss = false;
    });

    allCalls.forEach(call => {
        if (!call.derived_flags?.missed) return;

        const core = call.call_core;
        const missedEnd = core.ended_at || core.started_at;

        if (!core.caller_number || !missedEnd) return;

        const callback = allCalls.find(other => {
            if (!other.call_core) return false;
            if (other.call_core.call_id === core.call_id) return false;
            if (other.call_core.caller_number !== core.caller_number) return false;
            if (!other.call_core.started_at) return false;
            if (other.call_core.started_at <= missedEnd) return false;

            return other.call_core.started_at - missedEnd <= 600;
        });

        if (callback) {
            call.derived_flags.callback_after_miss = true;

            if (!call.routing_analysis) call.routing_analysis = {};

            call.routing_analysis.callback_detected = {
                callback_call_id: callback.call_core.call_id,
                seconds_after: callback.call_core.started_at - missedEnd,
                callback_result: callback.call_core.result,
                callback_answered_by: callback.call_core.answered_by_name || null
            };
        }
    });
}

function getModifiedCompanyOutcomes(calls) {
    const allCalls = Object.values(calls)
        .filter(call => call.call_core)
        .sort((a, b) => {
            const aTime = a.call_core.started_at || 0;
            const bTime = b.call_core.started_at || 0;
            return aTime - bTime;
        });

    const sessions = [];
    const groupedByCaller = {};

    allCalls.forEach(call => {
        const caller =
            call.call_core.caller_number ||
            `unknown-${call.call_core.call_id}`;

        if (!groupedByCaller[caller]) groupedByCaller[caller] = [];
        groupedByCaller[caller].push(call);
    });

    Object.values(groupedByCaller).forEach(callerCalls => {
        callerCalls.sort((a, b) => {
            const aTime = a.call_core.started_at || 0;
            const bTime = b.call_core.started_at || 0;
            return aTime - bTime;
        });

        let currentSession = [];

        callerCalls.forEach(call => {
            if (currentSession.length === 0) {
                currentSession.push(call);
                return;
            }

            const previousCall = currentSession[currentSession.length - 1];

            const previousEnd =
                previousCall.call_core.ended_at ||
                previousCall.call_core.started_at ||
                0;

            const currentStart = call.call_core.started_at || 0;
            const secondsBetween = currentStart - previousEnd;

            if (secondsBetween >= 0 && secondsBetween <= 600) {
                currentSession.push(call);
            } else {
                sessions.push(currentSession);
                currentSession = [call];
            }
        });

        if (currentSession.length > 0) {
            sessions.push(currentSession);
        }
    });

    const successfulSessions = sessions.filter(session =>
        session.some(call => call.derived_flags?.answered)
    );

    const recoveredMissedSessions = sessions.filter(session => {
        const hasMissedCall = session.some(call => call.derived_flags?.missed);
        const hasAnsweredCall = session.some(call => call.derived_flags?.answered);

        return hasMissedCall && hasAnsweredCall;
    });

    const modifiedCompanyAnswerRate =
        sessions.length > 0
            ? ((successfulSessions.length / sessions.length) * 100).toFixed(1)
            : '0.0';

    return {
        totalModifiedCalls: sessions.length,
        successfulModifiedCalls: successfulSessions.length,
        recoveredMissedCalls: recoveredMissedSessions.length,
        modifiedCompanyAnswerRate
    };
}

function getMissedCallBreakdown(calls) {
    const missedCalls = Object.values(calls).filter(call =>
        call.derived_flags?.missed
    );

    let busyCapacityMisses = 0;
    let declinedWhileAvailableMisses = 0;
    let noRingMisses = 0;
    let otherMisses = 0;

    missedCalls.forEach(call => {
        const routing = call.routing_analysis || {};
        const rangAgents = routing.rang_agents || [];
        const declinedAgents = routing.declined_agents || [];

        const declinedWhileAvailable = declinedAgents.some(declined => {
            const matchingRangAgent = rangAgents.find(agent =>
                agent.email === declined.email || agent.id === declined.id
            );

            return isAvailableStatus(matchingRangAgent || declined);
        });

        const allRangAgentsBusy =
            rangAgents.length > 0 &&
            rangAgents.every(agent => isBusyStatus(agent));

        if (declinedWhileAvailable) {
            declinedWhileAvailableMisses += 1;
        } else if (allRangAgentsBusy) {
            busyCapacityMisses += 1;
        } else if (rangAgents.length === 0) {
            noRingMisses += 1;
        } else {
            otherMisses += 1;
        }
    });

    const totalMissed = missedCalls.length;

    return {
        totalMissed,
        busyCapacityMisses,
        declinedWhileAvailableMisses,
        noRingMisses,
        otherMisses,
        busyMissRateOfAllCalls: '0.0',
        busyMissRateOfMissedCalls:
            totalMissed > 0
                ? ((busyCapacityMisses / totalMissed) * 100).toFixed(1)
                : '0.0',
        avoidableDeclineMissRateOfMissedCalls:
            totalMissed > 0
                ? ((declinedWhileAvailableMisses / totalMissed) * 100).toFixed(1)
                : '0.0'
    };
}

function getDeclineBehavior(calls) {
    const byUser = {};

    Object.values(calls).forEach(call => {
        const core = call.call_core || {};
        const routing = call.routing_analysis || {};
        const rangAgents = routing.rang_agents || [];
        const declinedAgents = routing.declined_agents || [];

        declinedAgents.forEach(declined => {
            const matchingRangAgent = rangAgents.find(agent =>
                agent.email === declined.email || agent.id === declined.id
            );

            const agent = matchingRangAgent || declined;
            const key = agent.email || agent.id || agent.name || 'unknown';

            if (!byUser[key]) {
                byUser[key] = {
                    name: agent.name || declined.name || 'Unknown',
                    email: agent.email || declined.email || '',
                    declinedCalls: 0,
                    declinedWhileAvailable: 0,
                    missedAfterDecline: 0,
                    associatedNumbers: {},
                    latestAvailability: agent.availability_status || 'unknown',
                    latestSubstatus: agent.substatus || ''
                };
            }

            byUser[key].declinedCalls += 1;

            if (isAvailableStatus(agent)) {
                byUser[key].declinedWhileAvailable += 1;
            }

            if (call.derived_flags?.missed) {
                byUser[key].missedAfterDecline += 1;
            }

            const numberLabel =
                `${core.called_number_name || 'Unknown number'} ` +
                `(${core.called_number_digits || 'unknown digits'})`;

            byUser[key].associatedNumbers[numberLabel] = true;

            if (agent.availability_status) {
                byUser[key].latestAvailability = agent.availability_status;
            }

            if (agent.substatus) {
                byUser[key].latestSubstatus = agent.substatus;
            }
        });
    });

    return Object.values(byUser)
        .map(user => ({
            ...user,
            associatedNumbers: Object.keys(user.associatedNumbers),
            declineMissRate:
                user.declinedCalls > 0
                    ? ((user.missedAfterDecline / user.declinedCalls) * 100).toFixed(1)
                    : '0.0',
            availableDeclineRate:
                user.declinedCalls > 0
                    ? ((user.declinedWhileAvailable / user.declinedCalls) * 100).toFixed(1)
                    : '0.0'
        }))
        .sort((a, b) => {
            if (b.declinedWhileAvailable !== a.declinedWhileAvailable) {
                return b.declinedWhileAvailable - a.declinedWhileAvailable;
            }

            return b.declinedCalls - a.declinedCalls;
        });
}

function buildExceptions(calls) {
    detectCallbacks(calls);

    const exceptions = [];

    Object.values(calls).forEach(call => {
        const core = call.call_core || {};
        const flags = call.derived_flags || {};
        const routing = call.routing_analysis || {};

        if (flags.owner_skipped) {
            exceptions.push({
                type: 'DID owner skipped',
                call_id: core.call_id,
                caller: core.caller_number,
                called_number: `${core.called_number_name} (${core.called_number_digits})`,
                did_owner: routing.did_owner_email,
                answered_by: core.answered_by_name || 'none',
                reason: routing.why_owner_did_not_answer
            });
        }

        if (flags.answered_by_backup_agent) {
            exceptions.push({
                type: 'Answered by backup agent',
                call_id: core.call_id,
                caller: core.caller_number,
                called_number: `${core.called_number_name} (${core.called_number_digits})`,
                did_owner: routing.did_owner_email,
                answered_by: core.answered_by_name,
                reason: routing.why_owner_did_not_answer
            });
        }

        if (flags.callback_after_miss) {
            exceptions.push({
                type: 'Caller called back after missed call',
                call_id: core.call_id,
                caller: core.caller_number,
                missed_reason: core.missed_call_reason,
                callback_call_id: routing.callback_detected?.callback_call_id,
                callback_answered_by: routing.callback_detected?.callback_answered_by,
                seconds_after: routing.callback_detected?.seconds_after
            });
        }

        if (flags.suspected_failed_answer) {
            exceptions.push({
                type: 'Suspected failed answer or unanswered ring',
                call_id: core.call_id,
                caller: core.caller_number,
                called_number: `${core.called_number_name} (${core.called_number_digits})`,
                rang_agents: (routing.rang_agents || []).map(a => a.name).join(', '),
                reason: 'Agents were rung, no answer event was recorded, and not every rung agent declined.'
            });
        }
    });

    return exceptions;
}

function getRingAttempts(calls) {
    const ringAttempts = [];

    Object.values(calls).forEach(call => {
        const core = call.call_core || {};
        const routing = call.routing_analysis || {};
        const rangAgents = routing.rang_agents || [];
        const declinedAgents = routing.declined_agents || [];

        if (rangAgents.length > 0) {
            rangAgents.forEach(agent => {
                const declined = declinedAgents.some(d =>
                    d.email === agent.email || d.id === agent.id
                );

                const answeredByThisAgent =
                    core.answered_by_email &&
                    agent.email &&
                    core.answered_by_email === agent.email;

                ringAttempts.push({
                    call_id: core.call_id,
                    caller: core.caller_number,
                    called_number_name: core.called_number_name,
                    called_number_digits: core.called_number_digits,
                    agent_name: agent.name,
                    agent_email: agent.email,
                    ring_time: agent.ring_time,
                    availability_status: agent.availability_status,
                    substatus: agent.substatus,
                    declined,
                    answered_by_this_agent: answeredByThisAgent,
                    call_result: core.result,
                    answered_by: core.answered_by_name,
                    source: 'aircall_ringing_on_agent'
                });
            }); 

            return;
        }

        ringAttempts.push({
            call_id: core.call_id,
            caller: core.caller_number,
            called_number_name: core.called_number_name,
            called_number_digits: core.called_number_digits,
            agent_name: core.answered_by_name || core.called_number_name || 'unknown',
            agent_email: core.answered_by_email || null,
            ring_time: core.started_at,
            availability_status: 'unknown',
            substatus: 'unknown',
            declined: false,
            answered_by_this_agent: Boolean(core.answered_by_email || core.answered_by_name),
            call_result: core.result,
            answered_by: core.answered_by_name,
            source: 'fallback_call_level_attempt'
        });
    });

    return ringAttempts;
}

function isDateCentral(unixTimestamp, targetDate = null) {
    if (!unixTimestamp) return false;

    const callDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date(unixTimestamp * 1000));

    if (targetDate) {
        return callDate === targetDate;
    }

    const todayCentral = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());

    return callDate === todayCentral;
}

function getExecutiveMetrics(calls, options = {}) {
    detectCallbacks(calls);

    const allHistoricalCalls = Object.values(calls).filter(call => call.call_core);

    const allCalls = allHistoricalCalls.filter(call =>
        isDateCentral(call.call_core?.started_at, options.snapshotDate)
    );

    const inboundCalls = allCalls.filter(call =>
        call.call_core?.direction === 'inbound'
    );

    const outboundCalls = allCalls.filter(call =>
        call.call_core?.direction === 'outbound'
    );
    
    const answeredCalls = inboundCalls.filter(call => call.derived_flags?.answered);
    const missedCalls = inboundCalls.filter(call => call.derived_flags?.missed);

    const businessHourCalls = inboundCalls.filter(call =>
        isBusinessHoursCentral(call.call_core?.started_at)
    );

    const businessHourAnsweredCalls = businessHourCalls.filter(call =>
        call.derived_flags?.answered
    );

    const businessHourRawAnswerRate =
        businessHourCalls.length > 0
            ? ((businessHourAnsweredCalls.length / businessHourCalls.length) * 100).toFixed(1)
            : '0.0';

    const afterHoursCalls = inboundCalls.filter(call =>
        !isBusinessHoursCentral(call.call_core?.started_at)
    );

    const afterHoursAnsweredCalls = afterHoursCalls.filter(call =>
        call.derived_flags?.answered
    );

    const afterHoursRawAnswerRate =
        afterHoursCalls.length > 0
            ? ((afterHoursAnsweredCalls.length / afterHoursCalls.length) * 100).toFixed(1)
            : '0.0';

    const companyAnswerRate =
        inboundCalls.length > 0
            ? ((answeredCalls.length / inboundCalls.length) * 100).toFixed(1)
            : '0.0';

    const routedCalls = inboundCalls.filter(call => {
        const routing = call.routing_analysis || {};
        const rangAgents = routing.rang_agents || [];
        return rangAgents.length > 0;
    });

    const routedAnsweredCalls = routedCalls.filter(call =>
        call.derived_flags?.answered
    );

    const routedAnswerRate =
        routedCalls.length > 0
            ? ((routedAnsweredCalls.length / routedCalls.length) * 100).toFixed(1)
            : '0.0';

    const userDailyStats = {};
    const roster = loadRoster();    

        inboundCalls.forEach(call => {
        const core = call.call_core || {};
        const routing = call.routing_analysis || {};
        const rangAgents = routing.rang_agents || [];
        const declinedAgents = routing.declined_agents || [];


        rangAgents.forEach(agent => {
            const key = agent.email || agent.name || agent.id || 'unknown';

            if (!userDailyStats[key]) {
                userDailyStats[key] = {
                    name: agent.name || 'Unknown',
                    email: agent.email || '',
                    totalRings: 0,
                    answeredCalls: 0,
                    declinedCalls: 0,
                    missedCalls: 0
                };
            }

            userDailyStats[key].totalRings += 1;

            const declined = declinedAgents.some(d =>
                d.email === agent.email || d.id === agent.id
            );

            const answeredByUser =
                core.answered_by_email &&
                agent.email &&
                core.answered_by_email === agent.email;

            if (answeredByUser) {
                userDailyStats[key].answeredCalls += 1;
            }

            if (declined) {
                userDailyStats[key].declinedCalls += 1;
            }

            if (call.derived_flags?.missed) {
                userDailyStats[key].missedCalls += 1;
            }
        });

        const answeredEmail = core.answered_by_email;

        if (answeredEmail) {
            const alreadyCountedAsRing = rangAgents.some(agent =>
                agent.email === answeredEmail
            );

            const key = answeredEmail;

            if (!userDailyStats[key]) {
                userDailyStats[key] = {
                    name: core.answered_by_name || answeredEmail,
                    email: answeredEmail,
                    totalRings: 0,
                    answeredCalls: 0,
                    declinedCalls: 0,
                    missedCalls: 0
                };
            }

            if (!alreadyCountedAsRing) {
                userDailyStats[key].totalRings += 1;
                userDailyStats[key].answeredCalls += 1;
            }
        }

        const isMissed = call.derived_flags?.missed;
        const numberName = String(core.called_number_name || '');
        const isDidCall = numberName.toLowerCase().endsWith(' did');

        if (isMissed && isDidCall && rangAgents.length === 0) {
            const didOwnerName = numberName
                .replace(/\s+DID$/i, '')
                .trim()
                .toLowerCase();

            const didOwner = (roster.users || []).find(user =>
                String(user.name || '').trim().toLowerCase() === didOwnerName
            );

            if (didOwner?.email) {
                const key = String(didOwner.email).toLowerCase();

                if (!userDailyStats[key]) {
                    userDailyStats[key] = {
                        name: didOwner.name || numberName,
                        email: key,
                        totalRings: 0,
                        answeredCalls: 0,
                        declinedCalls: 0,
                        missedCalls: 0
                    };
                }

                userDailyStats[key].totalRings += 1;
                userDailyStats[key].missedCalls += 1;
            }
        }

        
    });

    const modifiedCompanyOutcomes = getModifiedCompanyOutcomes(calls);
    const missedCallBreakdown = getMissedCallBreakdown(calls);

    missedCallBreakdown.busyMissRateOfAllCalls =
        allCalls.length > 0
            ? ((missedCallBreakdown.busyCapacityMisses / allCalls.length) * 100).toFixed(1)
            : '0.0';

    const ringAttempts = getRingAttempts(calls);

    const answeredRingAttempts = ringAttempts.filter(r => r.answered_by_this_agent);
    const declinedRingAttempts = ringAttempts.filter(r => r.declined);
    const unansweredRingAttempts = ringAttempts.filter(r =>
        !r.answered_by_this_agent && !r.declined
    );

    const employeeRingAnswerRate =
        ringAttempts.length > 0
            ? ((answeredRingAttempts.length / ringAttempts.length) * 100).toFixed(1)
            : '0.0';

    const callbacksAfterMiss = allCalls.filter(call =>
        call.derived_flags?.callback_after_miss
    );

    const suspectedFailedAnswers = allCalls.filter(call =>
        call.derived_flags?.suspected_failed_answer
    );

    const exceptions = buildExceptions(calls);
    const declineBehavior = getDeclineBehavior(calls);

    return {
        allCalls,
        inboundCalls,
        outboundCalls,
        allHistoricalCalls,
        answeredCalls,
        missedCalls,

        businessHourCalls,
        businessHourAnsweredCalls,
        businessHourRawAnswerRate,

        afterHoursCalls,
        afterHoursAnsweredCalls,
        afterHoursRawAnswerRate,

        companyAnswerRate,

        routedCalls,
        routedAnsweredCalls,
        routedAnswerRate,

        userDailyStats,

        modifiedCompanyOutcomes,
        missedCallBreakdown,

        ringAttempts,
        answeredRingAttempts,
        declinedRingAttempts,
        unansweredRingAttempts,

        employeeRingAnswerRate,

        callbacksAfterMiss,
        suspectedFailedAnswers,

        exceptions,
        declineBehavior
    };
}

function writeExecutiveReport(calls, reportingState = null) {
    const metrics = getExecutiveMetrics(calls);
    const reportingStatus = getReportingStatusText(reportingState);
    const missed = metrics.missedCallBreakdown;

    let output = '';

    output += `EXECUTIVE CALL REPORT\n`;
    output += `Generated: ${new Date().toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZoneName: 'short'
    })}\n\n`;

    output += `REPORTING SESSION\n`;
    output += `Status: ${reportingStatus.status}\n`;
    output += `Reporting Start Time: ${reportingStatus.started}\n`;
    output += `Reporting End Time: ${reportingStatus.ended}\n\n`;

    output += `COMPANY CALL OUTCOMES\n`;
    output += `Total unique calls: ${metrics.allCalls.length}\n`;
    output += `Answered calls: ${metrics.answeredCalls.length}\n`;
    output += `Missed calls: ${metrics.missedCalls.length}\n`;
    output += `Raw answer rate: ${metrics.companyAnswerRate}%\n`;
    output += `Customer resolution rate: ${metrics.modifiedCompanyOutcomes.modifiedCompanyAnswerRate}%\n`;
    output += `Recovered missed calls: ${metrics.modifiedCompanyOutcomes.recoveredMissedCalls}\n`;
    output += `Callbacks after missed calls: ${metrics.callbacksAfterMiss.length}\n`;
    output += `Occupancy missed calls: ${missed.busyCapacityMisses}\n`;
    output += `Declined while available misses: ${missed.declinedWhileAvailableMisses}\n`;
    output += `Calls missing ring telemetry: ${missed.noRingMisses}\n`;
    output += `Suspected failed answers: ${metrics.suspectedFailedAnswers.length}\n\n`;

    output += `INTERNAL CALL ACTIVITY\n`;
    output += `Total internal call records: ${metrics.ringAttempts.length}\n`;
    output += `Answered internal calls: ${metrics.answeredRingAttempts.length}\n`;
    output += `Declined internal calls: ${metrics.declinedRingAttempts.length}\n`;
    output += `Unanswered internal calls: ${metrics.unansweredRingAttempts.length}\n`;
    output += `Internal call answer rate: ${metrics.employeeRingAnswerRate}%\n\n`;

    output += `DECLINE BEHAVIOR\n`;

    if (metrics.declineBehavior.length === 0) {
        output += `No decline behavior detected.\n\n`;
    } else {
        metrics.declineBehavior.slice(0, 25).forEach((item, index) => {
            output += `${index + 1}. ${item.name} (${item.email})\n`;
            output += `   Declined calls: ${item.declinedCalls}\n`;
            output += `   Declined while available: ${item.declinedWhileAvailable}\n`;
            output += `   Misses after decline: ${item.missedAfterDecline}\n`;
            output += `   Availability: ${item.latestAvailability} ${item.latestSubstatus || ''}\n\n`;
        });
    }

    writeOutputFile('executive_report.txt', output);
}

function writeExecutiveHtmlReport(
    calls,
    reportingState = null,
    teamMappings = [],
    userRoleOverrides = {},
    roster = {}
) {
    const metrics = getExecutiveMetrics(calls);
    const reportingStatus = getReportingStatusText(reportingState);

    const html = buildExecutiveHtml(
        metrics,
        reportingStatus,
        teamMappings,
        userRoleOverrides,
        roster
    );

    writeOutputFile('executive_report.html', html);
}

function writeUsersHtmlReport(users = [], numbers = []) {
    const html = buildUsersHtml(users, numbers);

    writeOutputFile('users_report.html', html);
}

function writeBackfillTestHtmlReport(calls, reportingState = null) {
    const metrics = getExecutiveMetrics(calls);
    const html = buildBackfillTestHtml(metrics, reportingState);

    writeOutputFile('backfill_test_report.html', html);
}

function writeExceptionsReport(calls) {
    const exceptions = buildExceptions(calls);

    let output = '';

    output += `EXCEPTIONS REPORT\n`;
    output += `Generated: ${new Date().toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZoneName: 'short'
    })}\n\n`;

    if (!exceptions.length) {
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

    writeOutputFile('exceptions_report.txt', output);
}

function isBusinessHoursCentral(unixTimestamp) {
    if (!unixTimestamp) return false;

    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        hour: 'numeric',
        hour12: false,
        weekday: 'short'
    }).formatToParts(new Date(unixTimestamp * 1000));

    const hour = Number(parts.find(part => part.type === 'hour')?.value);

    return hour >= 7 && hour < 17;
}

module.exports = {
    detectCallbacks,
    buildExceptions,
    getExecutiveMetrics,
    writeExecutiveReport,
    writeExecutiveHtmlReport,
    writeUsersHtmlReport,
    writeBackfillTestHtmlReport,
    writeExceptionsReport,
    getExecutiveMetrics
};