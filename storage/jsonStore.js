const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..');

function getFilePath(filename) {
    return path.join(DATA_DIR, filename);
}

function loadJson(filename, fallback) {
    const filePath = getFilePath(filename);

    if (!fs.existsSync(filePath)) {
        return fallback;
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.log(`Failed to read ${filename}: ${error.message}`);
        return fallback;
    }
}

function saveJson(filename, data) {
    const filePath = getFilePath(filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

module.exports = {
    loadJson,
    saveJson
};