function buildBackfillHtml(metrics) {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Backfill Report</title>

    <style>
        body {
            font-family: Arial, sans-serif;
            background: #f6f7f9;
            color: #222;
            margin: 24px;
        }

        .section {
            background: white;
            padding: 18px;
            border-radius: 10px;
            margin-bottom: 24px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.08);
        }

        button {
            padding: 10px 16px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            color: white;
            font-weight: bold;
            background: #4f46e5;
        }
    </style>
</head>

<body>
    <button onclick="window.location.href='/report'">Executive Report</button>

    <div class="section">
        <h1>Backfill Dashboard</h1>

        <p>Total Calls: ${metrics.allCalls.length}</p>
        <p>Raw Answer Rate: ${metrics.companyAnswerRate}%</p>
        <p>Customer Resolution Rate: ${metrics.customerResolution.customerResolutionRate}%</p>
        <p>Occupancy Misses: ${metrics.missedCallBreakdown.busyCapacityMisses}</p>
        <p>Declined While Available Misses: ${metrics.missedCallBreakdown.declinedWhileAvailableMisses}</p>
        <p>Calls Missing Ring Telemetry: ${metrics.missedCallBreakdown.noRingMisses}</p>
    </div>
</body>
</html>
`;
}

module.exports = { buildBackfillHtml };