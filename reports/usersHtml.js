function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getAvailabilityClass(status) {

    const normalized =
        String(status || '')
            .toLowerCase();

    if (
        normalized.includes('available')
    ) {
        return 'available';
    }

    if (
        normalized.includes('busy') ||
        normalized.includes('call') ||
        normalized.includes('ringing')
    ) {
        return 'busy';
    }

    if (
        normalized.includes('wrap') ||
        normalized.includes('after_call')
    ) {
        return 'wrap';
    }

    if (
        normalized.includes('offline')
    ) {
        return 'offline';
    }

    if (
        normalized.includes('unavailable') ||
        normalized.includes('away') ||
        normalized.includes('break') ||
        normalized.includes('lunch') ||
        normalized.includes('meeting') ||
        normalized.includes('training') ||
        normalized.includes('dnd')
    ) {
        return 'unavailable';
    }

    if (
        normalized.includes('custom')
    ) {
        return 'custom';
    }

    return 'unknown';
}

function getAvailability(user) {
    return user.availability_status ||
        user.availability ||
        user.available ||
        user.status ||
        'unknown';
}

function buildUsersHtml(users = [], numbers = []) {
    const sortedUsers = [...users].sort((a, b) => {
        return String(getAvailability(a)).localeCompare(String(getAvailability(b)));
    });

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="refresh" content="300">
    <title>Aircall Users & Numbers</title>

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

        .section {
            background: white;
            padding: 18px;
            border-radius: 10px;
            margin-bottom: 24px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.08);
        }

        table {
            width: 100%;
            border-collapse: collapse;
        }

        th {
            text-align: left;
            background: #f0f1f3;
            padding: 10px;
            cursor: pointer;
            user-select: none;
        }

        td {
            border-top: 1px solid #e5e5e5;
            padding: 10px;
            vertical-align: top;
        }

        .row-available td {
        background: #f0fdf4;
        }

        .row-busy td {
        background: #fff7ed;
        }

        .row-wrap td {
        background: #fefce8;
        }

        .row-unavailable td {
        background: #fef2f2;
        }

        .row-offline td {
        background: #f9fafb;
        }

        .row-custom td {
        background: #eff6ff;
        }

        .sort-hint {
            color: #666;
            font-size: 13px;
            margin-bottom: 12px;
        }

        th.sortable::after {
            content: " ⇅";
            color: #666;
            font-size: 12px;
        }

        .small {
            color: #777;
            font-size: 12px;
        }

        button {
            padding: 10px 16px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            color: white;
            font-weight: bold;
            margin-right: 8px;
            margin-bottom: 8px;
        }

        .btn-back { background: #4f46e5; }
        .btn-refresh { background: #2563eb; }

        .status-pill {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: bold;
            color: white;
        }

        .status-available { background: #16a34a; }
        .status-busy { background: #ea580c; }
        .status-unavailable { background: #dc2626; }
        .status-offline { background: #374151; }
        .status-wrap { background: #ca8a04; }
        .status-unknown { background: #6b7280; }
        .status-custom { background: #2563eb; }
    </style>
</head>

<body>
    <div style="display:flex; justify-content:space-between; align-items:center; gap:20px; flex-wrap:wrap;">
        <div>
            <h1>Aircall Users & Numbers</h1>
            <div class="subtitle">
                Generated: ${new Date().toLocaleString()} · Auto-refreshes every 5 minutes
            </div>
        </div>

        <div>
            <button class="btn-back" onclick="window.location.href='/report'">Executive Report</button>
            <button class="btn-refresh" onclick="window.location.reload()">Refresh</button>
        </div>
    </div>

    <div class="section">
        <h2>Users</h2>
            <div class="sort-hint">Click any column header to sort the table.</div>

        ${
            sortedUsers.length === 0
                ? `<p>No users found.</p>`
                : `
                <table id="usersTable">
                    <thead>
                        <tr>
                            <th class="sortable" onclick="sortTable('usersTable', 0)">Name</th>
                            <th class="sortable" onclick="sortTable('usersTable', 1)">Email</th>
                            <th class="sortable" onclick="sortTable('usersTable', 2)">ID</th>
                            <th class="sortable" onclick="sortTable('usersTable', 3)">Availability</th>
                            <th class="sortable" onclick="sortTable('usersTable', 4)">Associated Numbers</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${sortedUsers.map(user => {
                            const userName =
                                user.name ||
                                `${user.first_name || ''} ${user.last_name || ''}`.trim() ||
                                'Unknown';

                            const availability = getAvailability(user);

                            const userNumbers = numbers.filter(number => {
                                const numberUsers = number.users || number.teammates || [];
                                return numberUsers.some(numberUser =>
                                    numberUser.id === user.id ||
                                    numberUser.email === user.email
                                );
                            });

                            return `
                                <tr class="row-${getAvailabilityClass(availability)}">
                                    <td>${escapeHtml(userName)}</td>
                                    <td>${escapeHtml(user.email || '')}</td>
                                    <td>${escapeHtml(user.id || '')}</td>
                                    <td>
                                        <span class="status-pill status-${getAvailabilityClass(availability)}">
                                            ${escapeHtml(availability)}
                                        </span>
                                        ${user.substatus ? `<br><span class="small">${escapeHtml(user.substatus)}</span>` : ''}
                                    </td>
                                    <td>
                                        ${
                                            userNumbers.length === 0
                                                ? '<span class="small">No associated numbers found</span>'
                                                : userNumbers.map(number => `
                                                    ${escapeHtml(number.name || 'Unnamed number')}
                                                    <br>
                                                    <span class="small">${escapeHtml(number.digits || number.phone_number || number.number || '')}</span>
                                                `).join('<br><br>')
                                        }
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
                `
        }
    </div>

    <div class="section">
        <h2>Numbers</h2>

        ${
            numbers.length === 0
                ? `<p>No numbers found.</p>`
                : `
                <table id="numbersTable">
                    <thead>
                        <tr>
                            <th onclick="sortTable('numbersTable', 0)">Number Name</th>
                            <th onclick="sortTable('numbersTable', 1)">Phone Number</th>
                            <th onclick="sortTable('numbersTable', 2)">ID</th>
                            <th onclick="sortTable('numbersTable', 3)">Associated Users</th>
                            <th onclick="sortTable('numbersTable', 4)">User Availability</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${numbers.map(number => {
                            const numberUsers = number.users || number.teammates || [];

                            return `
                                <tr>
                                    <td>${escapeHtml(number.name || 'Unnamed number')}</td>
                                    <td>${escapeHtml(number.digits || number.phone_number || number.number || '')}</td>
                                    <td>${escapeHtml(number.id || '')}</td>
                                    <td>
                                        ${
                                            numberUsers.length === 0
                                                ? '<span class="small">No users found</span>'
                                                : numberUsers.map(user => {
                                                    const userName =
                                                        user.name ||
                                                        `${user.first_name || ''} ${user.last_name || ''}`.trim() ||
                                                        'Unknown';

                                                    return `
                                                        ${escapeHtml(userName)}
                                                        ${user.email ? `<br><span class="small">${escapeHtml(user.email)}</span>` : ''}
                                                    `;
                                                }).join('<br><br>')
                                        }
                                    </td>
                                    <td>
                                        ${
                                            numberUsers.length === 0
                                                ? '<span class="small">No availability found</span>'
                                                : numberUsers.map(user => {
                                                    const availability = getAvailability(user);
                                                    const userName =
                                                        user.name ||
                                                        `${user.first_name || ''} ${user.last_name || ''}`.trim() ||
                                                        'Unknown';

                                                    return `
                                                        <strong>${escapeHtml(userName)}:</strong>
                                                        <span class="status-pill status-${getAvailabilityClass(availability)}">
                                                            ${escapeHtml(availability)}
                                                        </span>
                                                    `;
                                                }).join('<br><br>')
                                        }
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
                `
        }
    </div>

    <script>
        function sortTable(tableId, columnIndex) {
            const table = document.getElementById(tableId);
            const tbody = table.querySelector('tbody');
            const rows = Array.from(tbody.querySelectorAll('tr'));
            const currentDirection = table.getAttribute('data-sort-dir') || 'asc';
            const nextDirection = currentDirection === 'asc' ? 'desc' : 'asc';

            rows.sort((a, b) => {
                const aText = a.children[columnIndex].innerText.trim().toLowerCase();
                const bText = b.children[columnIndex].innerText.trim().toLowerCase();

                const aNumber = parseFloat(aText);
                const bNumber = parseFloat(bText);

                if (!isNaN(aNumber) && !isNaN(bNumber)) {
                    return nextDirection === 'asc' ? aNumber - bNumber : bNumber - aNumber;
                }

                return nextDirection === 'asc'
                    ? aText.localeCompare(bText)
                    : bText.localeCompare(aText);
            });

            rows.forEach(row => tbody.appendChild(row));
            table.setAttribute('data-sort-dir', nextDirection);
        }
    </script>
</body>
</html>
`;
}

module.exports = { buildUsersHtml };