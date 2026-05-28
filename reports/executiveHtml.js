function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function buildExecutiveHtml(metrics, reportingStatus) {
    const missed = metrics.missedCallBreakdown;

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="refresh" content="5">
    <title>Aircall Executive Report</title>

    <style>
        body {
            font-family: Arial, sans-serif;
            background: #f6f7f9;
            color: #222;
            margin: 24px;
        }

        h1 { margin-bottom: 4px; }

        .subtitle {
            color: #666;
            margin-bottom: 24px;
        }

        .top-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 20px;
            flex-wrap: wrap;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
            margin-bottom: 24px;
        }

        .card, .section {
            background: white;
            padding: 18px;
            border-radius: 10px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.08);
        }

        .section { margin-bottom: 24px; }

        .metric {
            font-size: 30px;
            font-weight: bold;
            margin-top: 8px;
        }

        .label {
            color: #666;
            font-size: 14px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
        }

        th {
            text-align: left;
            background: #f0f1f3;
            padding: 10px;
        }

        td {
            border-top: 1px solid #e5e5e5;
            padding: 10px;
            vertical-align: top;
        }

        .group-title {
            background: #e5e7eb;
            font-weight: bold;
            color: #111827;
        }

        .small {
            color: #777;
            font-size: 12px;
        }

        .badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: bold;
            background: #fff4db;
            color: #9a6700;
        }

        .danger-badge {
            background: #fdeaea;
            color: #b42318;
        }

        .status-badge {
            display: inline-block;
            padding: 6px 10px;
            border-radius: 999px;
            font-size: 13px;
            font-weight: bold;
        }

        .status-reporting {
            background: #e7f7ec;
            color: #16783a;
        }

        .status-stopped {
            background: #fdeaea;
            color: #b42318;
        }

        button {
            padding: 10px 16px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            color: white;
            font-weight: bold;
            margin-left: 8px;
            margin-bottom: 8px;
        }

        .btn-refresh { background: #2563eb; }
        .btn-start { background: #16a34a; }
        .btn-stop { background: #f59e0b; }
        .btn-reset { background: #dc2626; }
        .btn-users { background: #4f46e5; }
    </style>
</head>

<body>
    <div class="top-bar">
        <div>
            <h1>Aircall Executive Report</h1>
            <div class="subtitle">
                Generated: ${new Date().toLocaleString()} · Auto-refreshes every 5 seconds
            </div>
        </div>

        <div>
            <button class="btn-users" onclick="window.location.href='/users'">Users & Numbers</button>
            <button class="btn-refresh" onclick="window.location.reload()">Refresh</button>
            <button class="btn-start" onclick="window.location.href='/start-reporting'">Start Reporting</button>
            <button class="btn-stop" onclick="window.location.href='/stop-reporting'">Stop Reporting</button>
            <button class="btn-reset" onclick="if(confirm('Reset all datasets?')) window.location.href='/reset';">Reset Data</button>
        </div>
    </div>

    <div class="section">
        <h2>Reporting Session</h2>
        <table>
            <tr>
                <th>Status</th>
                <th>Reporting Start Time</th>
                <th>Reporting End Time</th>
            </tr>
            <tr>
                <td>
                    <span class="status-badge ${reportingStatus.status === 'Reporting' ? 'status-reporting' : 'status-stopped'}">
                        ${reportingStatus.status}
                    </span>
                </td>
                <td>${reportingStatus.started}</td>
                <td>${reportingStatus.ended}</td>
            </tr>
        </table>
    </div>

    <div class="grid">
        <div class="card">
            <div class="label">Total Unique Calls</div>
            <div class="metric">${metrics.allCalls.length}</div>
        </div>

        <div class="card">
            <div class="label">Raw Answer Rate</div>
            <div class="metric">${metrics.companyAnswerRate}%</div>
        </div>

        <div class="card">
            <div class="label">Business Hours Raw Answer Rate</div>
        
            <div class="metric">
                ${metrics.businessHourRawAnswerRate}%
            </div>

            <div class="small">
                ${metrics.businessHourAnsweredCalls.length} /
                ${metrics.businessHourCalls.length}
                calls from 7 AM–5 PM CT
            </div>
        </div>

        <div class="card">
            <div class="label">After Hours Raw Answer Rate</div>

            <div class="metric">
                ${metrics.afterHoursRawAnswerRate}%
            </div>

            <div class="small">
                ${metrics.afterHoursAnsweredCalls.length} /
                ${metrics.afterHoursCalls.length}
                calls outside 7 AM–5 PM CT
            </div>
        </div>

        <div class="card">
            <div class="label">Customer Resolution Rate</div>
            <div class="metric">${metrics.modifiedCompanyOutcomes.modifiedCompanyAnswerRate}%</div>
        </div>

        <div class="card">
            <div class="label">Occupancy Miss Rate</div>
            <div class="metric">${missed.busyMissRateOfAllCalls}%</div>
        </div>
    </div>

    <div class="section">
    <h2>Company Call Outcomes</h2>

    <table>
        <tr><th>Metric</th><th>Value</th></tr>

        <tr><td colspan="2" class="group-title">Core Customer Outcome KPIs</td></tr>

        <tr><td>Total unique calls</td><td>${metrics.allCalls.length}</td></tr>
        <tr><td>Answered calls</td><td>${metrics.answeredCalls.length}</td></tr>
        <tr><td>Missed calls</td><td>${metrics.missedCalls.length}</td></tr>

        <tr>
            <td>
                Raw answer rate
                <br>
                <span class="small">All answered calls divided by all captured calls.</span>
            </td>
            <td>${metrics.companyAnswerRate}%</td>
        </tr>

        <tr>
            <td>
                Business hours raw answer rate
                <br>
                <span class="small">Calls started between 7:00 AM and 5:00 PM Central.</span>
            </td>
            <td>${metrics.businessHourRawAnswerRate}%</td>
        </tr>

        <tr>
            <td>
                After hours raw answer rate
                <br>
                <span class="small">Calls outside 7:00 AM–5:00 PM Central.</span>
            </td>
            <td>${metrics.afterHoursRawAnswerRate}%</td>
        </tr>

        <tr>
            <td>
                Routed answer rate
                <br>
                <span class="small">Answered calls divided by calls where at least one agent ring event was captured.</span>
            </td>
            <td>${metrics.routedAnswerRate}%</td>
        </tr>

        <tr>
            <td>
                Customer resolution rate
                <br>
                <span class="small">Groups quick repeat calls from the same caller into one customer interaction. If one call in that sequence is answered, the interaction counts as successful.</span>
            </td>
            <td>${metrics.modifiedCompanyOutcomes.modifiedCompanyAnswerRate}%</td>
        </tr>

        <tr><td colspan="2" class="group-title">Business Hours Detail</td></tr>

        <tr>
            <td>Business hours calls</td>
            <td>${metrics.businessHourCalls.length}</td>
        </tr>

        <tr>
            <td>Business hours answered calls</td>
            <td>${metrics.businessHourAnsweredCalls.length}</td>
        </tr>

        <tr>
            <td>After hours calls</td>
            <td>${metrics.afterHoursCalls.length}</td>
        </tr>

        <tr>
            <td>After hours answered calls</td>
            <td>${metrics.afterHoursAnsweredCalls.length}</td>
        </tr>

        <tr><td colspan="2" class="group-title">Routing Detail</td></tr>

        <tr>
            <td>
                Routed calls
                <br>
                <span class="small">Calls where at least one agent ring event was captured.</span>
            </td>
            <td>${metrics.routedCalls.length}</td>
        </tr>

        <tr>
            <td>Routed answered calls</td>
            <td>${metrics.routedAnsweredCalls.length}</td>
        </tr>

        <tr><td colspan="2" class="group-title">Recovery Metrics</td></tr>

        <tr><td>Modified customer interactions</td><td>${metrics.modifiedCompanyOutcomes.totalModifiedCalls}</td></tr>
        <tr><td>Successful customer interactions</td><td>${metrics.modifiedCompanyOutcomes.successfulModifiedCalls}</td></tr>
        <tr><td>Recovered missed calls</td><td>${metrics.modifiedCompanyOutcomes.recoveredMissedCalls}</td></tr>
        <tr><td>Callbacks after missed calls</td><td>${metrics.callbacksAfterMiss.length}</td></tr>

        <tr><td colspan="2" class="group-title">Capacity / Staffing Metrics</td></tr>

        <tr><td>Occupancy missed calls</td><td>${missed.busyCapacityMisses}</td></tr>
        <tr><td>Occupancy miss rate of all calls</td><td>${missed.busyMissRateOfAllCalls}%</td></tr>
        <tr><td>Occupancy miss rate of missed calls</td><td>${missed.busyMissRateOfMissedCalls}%</td></tr>

        <tr><td colspan="2" class="group-title">Avoidable Miss Metrics</td></tr>

        <tr><td>Declined while available misses</td><td>${missed.declinedWhileAvailableMisses}</td></tr>
        <tr><td>Avoidable miss rate of missed calls</td><td>${missed.avoidableDeclineMissRateOfMissedCalls}%</td></tr>

        <tr><td colspan="2" class="group-title">System / Telemetry Confidence</td></tr>

        <tr>
            <td>
                Calls missing ring telemetry
                <br>
                <span class="small">Missed calls with no captured agent ring data. This can mean true no-ring routing, API-only backfill, webhook gaps, IVR behavior, or incomplete telemetry.</span>
            </td>
            <td>${missed.noRingMisses}</td>
        </tr>

        <tr><td>Other missed calls</td><td>${missed.otherMisses}</td></tr>
        <tr><td>Suspected failed answers</td><td>${metrics.suspectedFailedAnswers.length}</td></tr>
    </table>
    </div>

    <div class="section">
        <h2>Internal Call Activity</h2>
        <table>
            <tr><th>Metric</th><th>Value</th></tr>
            <tr><td>Total internal call records</td><td>${metrics.ringAttempts.length}</td></tr>
            <tr><td>Answered internal calls</td><td>${metrics.answeredRingAttempts.length}</td></tr>
            <tr><td>Declined internal calls</td><td>${metrics.declinedRingAttempts.length}</td></tr>
            <tr><td>Unanswered internal calls</td><td>${metrics.unansweredRingAttempts.length}</td></tr>
            <tr><td>Internal call answer rate</td><td>${metrics.employeeRingAnswerRate}%</td></tr>
        </table>
    </div>

    <div class="section">
        <h2>Decline Behavior - Manager Review</h2>
        ${
            metrics.declineBehavior.length === 0
                ? `<p>No declined calls detected.</p>`
                : `
                <table>
                    <tr>
                        <th>User</th>
                        <th>Email</th>
                        <th>Declined Calls</th>
                        <th>Declined While Available</th>
                        <th>Misses After Decline</th>
                        <th>Available Decline Rate</th>
                        <th>Latest Availability</th>
                        <th>Numbers</th>
                    </tr>
                    ${metrics.declineBehavior.slice(0, 50).map(item => `
                        <tr>
                            <td>${escapeHtml(item.name)}</td>
                            <td>${escapeHtml(item.email)}</td>
                            <td>${item.declinedCalls}</td>
                            <td><span class="badge danger-badge">${item.declinedWhileAvailable}</span></td>
                            <td>${item.missedAfterDecline}</td>
                            <td>${item.availableDeclineRate}%</td>
                            <td>${escapeHtml(item.latestAvailability || 'unknown')}</td>
                            <td>${item.associatedNumbers.map(number => escapeHtml(number)).join('<br>')}</td>
                        </tr>
                    `).join('')}
                </table>
                `
        }
    </div>

    <div class="section">
        <h2>Top Exceptions</h2>
        ${
            metrics.exceptions.length === 0
                ? `<p>No exceptions detected.</p>`
                : `
                <table>
                    <tr>
                        <th>Type</th>
                        <th>Call ID</th>
                        <th>Caller</th>
                        <th>Called Number</th>
                        <th>Details</th>
                    </tr>
                    ${metrics.exceptions.slice(0, 50).map(item => `
                        <tr>
                            <td><span class="badge">${escapeHtml(item.type)}</span></td>
                            <td>${escapeHtml(item.call_id || '')}</td>
                            <td>${escapeHtml(item.caller || '')}</td>
                            <td>${escapeHtml(item.called_number || '')}</td>
                            <td>
                                ${escapeHtml(item.reason || '')}
                                ${item.answered_by ? `<br><span class="small">Answered by: ${escapeHtml(item.answered_by)}</span>` : ''}
                                ${item.callback_call_id ? `<br><span class="small">Callback call: ${escapeHtml(item.callback_call_id)}</span>` : ''}
                            </td>
                        </tr>
                    `).join('')}
                </table>
                `
        }
    </div>
</body>
</html>
`;
}

module.exports = { buildExecutiveHtml };