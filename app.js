/**
 * Nigi Ben (DMK) Inventory Dashboard App logic
 */

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/11Mu-cO632cHm1oqp4CJpbIP4BUrIoEr7Rr5H3gbK3C0/gviz/tq?tqx=out:csv&gid=1771017753';

// Global Chart Instances
let trendChart = null;
let topProductsChart = null;
let topWasteChart = null;

// Extracted Data
let globalStoreData = []; // [{date, dayNum, products: [...]}, ...]
let activeDayIndex = -1;

// Sorting state
let sortCol = '';
let sortAsc = true;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    fetchData();

    // Auto refresh every 5 minutes (300000 ms)
    setInterval(fetchData, 300000);

    // Manual refresh button
    document.getElementById('refresh-btn').addEventListener('click', () => {
        const icon = document.querySelector('#refresh-btn i');
        icon.classList.add('fa-spin');
        fetchData().finally(() => {
            setTimeout(() => icon.classList.remove('fa-spin'), 1000);
        });
    });

    // Day selector listener
    document.getElementById('day-selector').addEventListener('change', (e) => {
        activeDayIndex = parseInt(e.target.value, 10);
        updateDashboardView();
    });

    // Search listener
    document.getElementById('search-input').addEventListener('input', () => {
        renderTable();
    });

    // Sort listeners
    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', (e) => {
            const col = th.getAttribute('data-sort');
            if (sortCol === col) {
                sortAsc = !sortAsc;
            } else {
                sortCol = col;
                sortAsc = true;
            }

            // Update icons
            document.querySelectorAll('th[data-sort] i').forEach(icon => {
                icon.className = 'fas fa-sort ml-1 text-gray-600';
            });
            const icon = th.querySelector('i');
            icon.className = sortAsc ? 'fas fa-sort-up ml-1 text-indigo-400' : 'fas fa-sort-down ml-1 text-indigo-400';

            renderTable();
        });
    });
});

async function fetchData() {
    try {
        console.log('Fetching fresh inventory data...');
        // Use a CORS proxy to bypass browser restrictions
        const url = `https://corsproxy.io/?url=${encodeURIComponent(SHEET_CSV_URL)}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const csvText = await response.text();
        parseCSV(csvText);

        // Show content, hide loader
        document.getElementById('loader').classList.add('hidden');
        document.getElementById('dashboard-content').classList.remove('hidden');

        // Update timestamp
        const now = new Date();
        document.getElementById('last-updated').textContent = now.toLocaleTimeString('th-TH') + ' (' + now.toLocaleDateString('th-TH') + ')';

    } catch (error) {
        console.error('Error fetching data:', error);
        document.getElementById('last-updated').textContent = 'Update Failed';
        document.getElementById('last-updated').classList.add('text-red-400');
    }
}

function parseCSV(csvText) {
    Papa.parse(csvText, {
        complete: function (results) {
            processData(results.data);
        },
        error: function (err) {
            console.error('Papa Parse Error:', err);
        }
    });
}

function cleanNumber(val) {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    // Remove formatting
    const cleanStr = val.toString().replace(/,/g, '').trim();
    if (cleanStr === '' || cleanStr === '-') return 0;
    const num = parseFloat(cleanStr);
    return isNaN(num) ? 0 : num;
}

function processData(data) {
    if (!data || data.length < 2) return;

    // Detect Max Days available.
    // Daily columns start at index 8 and each day is 8 columns wide.
    const row1 = data[0];
    const totalCols = row1.length;
    let maxDays = Math.floor((totalCols - 8) / 8);

    // Safety cap
    if (maxDays > 31) maxDays = 31;
    if (maxDays < 1) maxDays = 1;

    globalStoreData = [];
    let previousDayRemain = {};

    // Parse Data Day by Day
    for (let day = 1; day <= maxDays; day++) {
        let dayStartCol = 8 + (day - 1) * 8;

        // Find Date string from header if possible
        let dateLabel = `วันที่ ${day}`;
        if (row1[dayStartCol] && typeof row1[dayStartCol] === 'string') {
            const match = row1[dayStartCol].match(/^\d+\s+[^ ]+/);
            if (match) dateLabel = match[0];
        }

        let products = [];
        let dayHasAnyData = false;

        // Start reading products from row 2 (index 1) to end (excluding summary rows at bottom if any)
        for (let i = 1; i < data.length; i++) {
            const row = data[i];

            // Validate it's a product row (has name and category)
            if (!row || !row[1] || row[1].trim() === '' || !row[3] || row[3].trim() === '') {
                // Skip non-product rows
                continue;
            }

            const category = row[1];
            const code = row[2];
            const name = row[3];

            // Extract numbers for this day (robust header extraction)
            let received = 0;
            let sold = 0;
            let waste = 0;
            let broughtForwardSheet = 0;

            for (let c = 0; c < 8; c++) {
                const header = (row1[dayStartCol + c] || '').toLowerCase();
                const val = cleanNumber(row[dayStartCol + c]);
                const absVal = Math.abs(val);

                if (header.includes('ยกมา')) {
                    broughtForwardSheet = val;
                } else if (header.includes('รับเข้า') || header.includes('total')) {
                    received = Math.max(received, absVal);
                } else if (header.includes('ขาย') || header.includes('ตัดสต็อก')) {
                    sold += absVal;
                } else if (header.includes('was') || header.includes('ทิ้ง')) {
                    waste += absVal;
                }
            }

            // Set initial previous day remain if day 1 and it has 'ยกมา' in the sheet
            if (day === 1 && !previousDayRemain[code] && broughtForwardSheet > 0) {
                previousDayRemain[code] = broughtForwardSheet;
            }

            let broughtForward = previousDayRemain[code] || 0;
            let remain = broughtForward + received - sold - waste;

            // Save for the next day's iteration
            previousDayRemain[code] = remain;

            if (broughtForward !== 0 || received !== 0 || sold !== 0 || waste !== 0 || remain !== 0) {
                dayHasAnyData = true;
            }

            products.push({
                category,
                code,
                name,
                broughtForward,
                received,
                sold,
                waste,
                remain
            });
        }

        globalStoreData.push({
            dayNum: day,
            dateLabel: dateLabel,
            hasData: dayHasAnyData,
            products: products
        });
    }

    // Filter out future days that don't have data at all yet
    const validDays = globalStoreData.filter(d => d.hasData);
    if (validDays.length > 0) {
        globalStoreData = validDays;
    }

    // Populate Selector
    const selector = document.getElementById('day-selector');
    selector.innerHTML = '';

    globalStoreData.forEach((dayData, idx) => {
        const option = document.createElement('option');
        option.value = idx;
        option.textContent = dayData.dateLabel;
        selector.appendChild(option);
    });

    // Determine active day (default to latest day with data)
    if (activeDayIndex === -1 || activeDayIndex >= globalStoreData.length) {
        // Find latest day with non-zero sales
        let latestActive = globalStoreData.length - 1;
        for (let j = globalStoreData.length - 1; j >= 0; j--) {
            const daySales = globalStoreData[j].products.reduce((acc, p) => acc + p.sold, 0);
            if (daySales > 0) {
                latestActive = j;
                break;
            }
        }
        activeDayIndex = latestActive;
    }

    selector.value = activeDayIndex;

    updateDashboardView();
}

function updateDashboardView() {
    if (activeDayIndex < 0 || activeDayIndex >= globalStoreData.length) return;

    const currentDayData = globalStoreData[activeDayIndex];
    document.getElementById('summary-title').textContent = `ภาพรวมสต็อกประจำวัน (${currentDayData.dateLabel})`;

    // Calculate Summary Totals for selected day
    let totalRec = 0;
    let totalSold = 0;
    let totalWa = 0;
    let totalRem = 0;

    currentDayData.products.forEach(p => {
        totalRec += p.received;
        totalSold += p.sold;
        totalWa += p.waste;
        totalRem += p.remain;
    });

    // Animate numbers
    animateValue('total-received', 0, totalRec, 500);
    animateValue('total-sold', 0, totalSold, 500);
    animateValue('total-waste', 0, totalWa, 500);
    animateValue('total-remaining', 0, Math.max(0, totalRem), 500); // Floor at 0 for display

    // Render Table
    renderTable();

    // Render Charts
    renderTrendChart();
    renderTopProductsChart();
    renderTopWasteChart();
}

function animateValue(id, start, end, duration) {
    if (end === 0) {
        document.getElementById(id).textContent = "0";
        return;
    }
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const current = Math.floor(progress * (end - start) + start);
        document.getElementById(id).textContent = current.toLocaleString('en-US');
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

function renderTable() {
    const tbody = document.getElementById('inventory-table-body');
    const searchTerm = document.getElementById('search-input').value.toLowerCase();

    const currentDayData = globalStoreData[activeDayIndex];
    tbody.innerHTML = '';

    const filtered = currentDayData.products.filter(p =>
        p.name.toLowerCase().includes(searchTerm) ||
        p.category.toLowerCase().includes(searchTerm) ||
        (p.code && p.code.toLowerCase().includes(searchTerm))
    );

    // Apply sorting
    if (sortCol) {
        filtered.sort((a, b) => {
            let valA = a[sortCol];
            let valB = b[sortCol];

            if (typeof valA === 'string') {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }

            if (valA < valB) return sortAsc ? -1 : 1;
            if (valA > valB) return sortAsc ? 1 : -1;
            return 0;
        });
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-8 text-center text-gray-400">ไม่พบข้อมูลสินค้า</td></tr>';
        return;
    }

    filtered.forEach(p => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-white/5 border-b border-white/5 transition-colors';

        let remClass = 'text-amber-300';
        if (p.remain === 0 && (p.received > 0 || p.broughtForward > 0)) remClass = 'text-gray-500'; // All sold out!
        if (p.remain < 0) remClass = 'text-rose-400';

        tr.innerHTML = `
            <td class="px-6 py-3 font-mono text-xs text-gray-400">${p.code || '-'}</td>
            <td class="px-6 py-3 font-medium text-white">${p.name}</td>
            <td class="px-6 py-3 text-xs">
                <span class="px-2 py-1 rounded-full bg-indigo-500/20 text-indigo-300">${p.category}</span>
            </td>
            <td class="px-6 py-3 text-center text-gray-400">${p.broughtForward > 0 ? p.broughtForward : '-'}</td>
            <td class="px-6 py-3 text-center text-blue-300 font-semibold">${p.received > 0 ? p.received : '-'}</td>
            <td class="px-6 py-3 text-center text-emerald-400 font-bold">${p.sold > 0 ? p.sold : '-'}</td>
            <td class="px-6 py-3 text-center text-rose-300">${p.waste > 0 ? p.waste : '-'}</td>
            <td class="px-6 py-3 text-center ${remClass} font-bold">${p.remain}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderTrendChart() {
    const ctx = document.getElementById('trendChart').getContext('2d');
    Chart.defaults.color = '#9ca3af';
    Chart.defaults.font.family = "'Inter', sans-serif";

    if (trendChart) {
        trendChart.destroy();
    }

    const labels = [];
    const receivedData = [];
    const soldData = [];
    const wasteData = [];

    // Map month data
    globalStoreData.forEach(day => {
        labels.push(day.dateLabel); // e.g. "1 ก.พ."

        let recv = 0, sold = 0, waste = 0;
        day.products.forEach(p => {
            recv += p.received;
            sold += p.sold;
            waste += p.waste;
        });

        receivedData.push(recv);
        soldData.push(sold);
        wasteData.push(waste);
    });

    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'รับเข้า (Received)',
                    data: receivedData,
                    borderColor: '#3b82f6', // blue
                    borderDash: [5, 5],
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 0
                },
                {
                    label: 'ยอดขาย (Sold)',
                    data: soldData,
                    borderColor: '#10b981', // emerald
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#10b981',
                    pointRadius: 3
                },
                {
                    label: 'ของเสีย (Waste)',
                    data: wasteData,
                    borderColor: '#f43f5e', // rose
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#e2e8f0', usePointStyle: true, boxWidth: 8 }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#e2e8f0',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false }
                }
            }
        }
    });
}

function renderTopProductsChart() {
    const ctx = document.getElementById('topProductsChart').getContext('2d');

    if (topProductsChart) {
        topProductsChart.destroy();
    }

    const currentDayData = globalStoreData[activeDayIndex];

    // Sort by sold descending
    const sorted = [...currentDayData.products].sort((a, b) => b.sold - a.sold).slice(0, 10);

    // If everything is 0
    if (sorted.length === 0 || sorted[0].sold === 0) {
        // Render Empty Chart
        topProductsChart = new Chart(ctx, {
            type: 'bar',
            data: { labels: ['No Data'], datasets: [{ data: [0] }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
        return;
    }

    const labels = sorted.map(p => p.name.length > 20 ? p.name.substring(0, 20) + '...' : p.name);
    const data = sorted.map(p => p.sold);

    const gradientBar = ctx.createLinearGradient(0, 0, 400, 0);
    gradientBar.addColorStop(0, '#8b5cf6'); // violet
    gradientBar.addColorStop(1, '#ec4899'); // pink

    topProductsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'ยอดขาย (ชิ้น/กล่อง)',
                data: data,
                backgroundColor: gradientBar,
                borderRadius: 4,
            }]
        },
        options: {
            indexAxis: 'y', // Horizontal bar chart
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    padding: 10
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    beginAtZero: true
                },
                y: {
                    grid: { display: false }
                }
            }
        }
    });
}

function renderTopWasteChart() {
    const ctx = document.getElementById('topWasteChart').getContext('2d');

    if (topWasteChart) {
        topWasteChart.destroy();
    }

    const currentDayData = globalStoreData[activeDayIndex];

    // Sort by waste descending
    const sorted = [...currentDayData.products].sort((a, b) => b.waste - a.waste).slice(0, 10);

    // If everything is 0
    if (sorted.length === 0 || sorted[0].waste === 0) {
        // Render Empty Chart
        topWasteChart = new Chart(ctx, {
            type: 'bar',
            data: { labels: ['ไม่มีของเสีย'], datasets: [{ data: [0] }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
        return;
    }

    const labels = sorted.map(p => p.name.length > 20 ? p.name.substring(0, 20) + '...' : p.name);
    const data = sorted.map(p => p.waste);

    const gradientBar = ctx.createLinearGradient(0, 0, 400, 0);
    gradientBar.addColorStop(0, '#f43f5e'); // rose-500
    gradientBar.addColorStop(1, '#ef4444'); // red-500

    topWasteChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'ยอดสูญเสีย (ชิ้น/กล่อง)',
                data: data,
                backgroundColor: gradientBar,
                borderRadius: 4,
            }]
        },
        options: {
            indexAxis: 'y', // Horizontal bar chart
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    padding: 10
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    beginAtZero: true
                },
                y: {
                    grid: { display: false }
                }
            }
        }
    });
}
