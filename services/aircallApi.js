async function aircallApi(apiPath) {
    if (!process.env.AIRCALL_API_ID || !process.env.AIRCALL_API_TOKEN) {
        console.log('Missing AIRCALL_API_ID or AIRCALL_API_TOKEN in .env');
        return null;
    }

    const auth = Buffer.from(
        `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`
    ).toString('base64');

    try {
        const response = await fetch(`https://api.aircall.io${apiPath}`, {
            method: 'GET',
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.log(`Aircall API error ${response.status} for ${apiPath}`);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.log(`Aircall API request failed for ${apiPath}: ${error.message}`);
        return null;
    }
}

async function fetchAllAircallPages(basePath, rootKey) {
    const allItems = [];
    let page = 1;
    const perPage = 50;

    while (true) {
        const separator = basePath.includes('?') ? '&' : '?';
        const response = await aircallApi(`${basePath}${separator}page=${page}&per_page=${perPage}`);
        const items = response?.[rootKey] || [];

        console.log(`Fetched ${rootKey} page ${page}: ${items.length}`);

        allItems.push(...items);

        if (items.length < perPage) break;

        page += 1;
    }

    return allItems;
}

module.exports = {
    aircallApi,
    fetchAllAircallPages
};