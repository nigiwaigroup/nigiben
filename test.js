const fs = require('fs');
const Papa = require('./node_modules/papaparse/papaparse.min.js'); // PapaParse typically isn't directly exposed like this if installed globally, let's use a simpler CSV parser or fetch from CDN using pure js in script, wait I can just string split since the CSV is well quoted. Or I'll write a quick manual manual parse for debugging.

const csvText = fs.readFileSync('test_new.csv', 'utf8');

function cleanNumber(val) {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    const cleanStr = val.toString().replace(/,/g, '').trim();
    if (cleanStr === '' || cleanStr === '-') return 0;
    const num = parseFloat(cleanStr);
    return isNaN(num) ? 0 : num;
}

// manual parse 
let lines = csvText.split('\n').filter(line => line.trim().length > 0);
let data = lines.map(line => {
    // Basic regex for parsing CSV row 
    let row = [];
    let insideQuote = false;
    let current = '';
    for (let i = 0; i < line.length; i++) {
        let char = line[i];
        if (char === '"') {
            insideQuote = !insideQuote;
        } else if (char === ',' && !insideQuote) {
            row.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    row.push(current);
    return row;
});

const row1 = data[0];
const totalCols = row1.length;
let maxDays = Math.floor((totalCols - 8) / 8);

for (let day = 1; day <= maxDays; day++) {
    let dayStartCol = 8 + (day - 1) * 8;
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (row[3] && row[3].includes("น้ำเปล่า น้ำทิพย์")) {
            const val0 = cleanNumber(row[dayStartCol + 0]);
            const val1 = cleanNumber(row[dayStartCol + 1]);
            const received = Math.max(val0, val1) || val0 || val1;

            const val2 = cleanNumber(row[dayStartCol + 2]);
            const val3 = cleanNumber(row[dayStartCol + 3]);
            const sold = Math.abs(val2) + Math.abs(val3);

            const waste = Math.abs(cleanNumber(row[dayStartCol + 4]));
            const remain = cleanNumber(row[dayStartCol + 5]) + cleanNumber(row[dayStartCol + 6]) + cleanNumber(row[dayStartCol + 7]);

            if (received > 0 || sold > 0 || waste > 0 || remain > 0) {
                console.log(`Day: ${day} (Col ${dayStartCol})`);
                console.log(`Raw vals: ${row[dayStartCol + 0]}, ${row[dayStartCol + 1]}, ${row[dayStartCol + 2]}, ${row[dayStartCol + 3]}`);
                console.log(`Received: ${received}, Sold: ${sold}, Remain: ${remain}`);
            }
        }
    }
}
