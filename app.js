/**
 * app.js — Nigiben DMK Inventory Dashboard
 * Reads file1.csv (inventory) + file2.csv (receipts with dates)
 * Joins on receipt number to produce date-tagged inventory rows.
 */

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
const CSV_INVENTORY = 'file1.csv';  // flat: zone,receipt,code,name,bfwd,rcv,total,sold,waste,oth,remain
const CSV_RECEIPTS  = 'file2.csv';  // hierarchical: zone,receipt,datetime | ,,code/name,qty,price,...

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let allRows      = [];   // processed inventory rows [{date, code, name, category, bfwd, received, sold, waste, remaining}]
let filteredRows = [];   // rows for currently selected date
let charts       = {};   // Chart.js instances
let sortState    = { col: null, dir: 'asc' };

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadData();

    document.getElementById('refresh-btn').addEventListener('click', () => {
        const btn = document.getElementById('refresh-btn');
        btn.classList.add('spinning');
        allRows = [];
        filteredRows = [];
        loadData().finally(() => btn.classList.remove('spinning'));
    });

    document.getElementById('search-input').addEventListener('input', () => {
        renderTable(filteredRows);
    });

    document.getElementById('day-selector').addEventListener('change', (e) => {
        applyDateFilter(e.target.value);
    });

    // Column sort
    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => handleSort(th.dataset.sort));
    });
});

// ─────────────────────────────────────────────
// DATA LOADING
// ─────────────────────────────────────────────
async function loadData() {
    showLoader(true);
    try {
        const [inv, rcv] = await Promise.all([
            fetchCSV(CSV_INVENTORY),
            fetchCSV(CSV_RECEIPTS)
        ]);

        const dateMap = buildDateMap(rcv);
        allRows = parseInventory(inv, dateMap);

        populateDaySelector(allRows);
        // Default to first available date
        const firstDate = getUniqueDates(allRows)[0] || '';
        document.getElementById('day-selector').value = firstDate;
        applyDateFilter(firstDate);

        document.getElementById('last-updated').textContent = new Date().toLocaleString('th-TH');
        showLoader(false);
    } catch (err) {
        console.error('Data load error:', err);
        document.getElementById('loader').innerHTML =
            `<p class="text-red-400">❌ ไม่สามารถโหลดข้อมูลได้: ${err.message}</p>`;
    }
}

function fetchCSV(url) {
    return new Promise((resolve, reject) => {
        Papa.parse(url, {
            download: true,
            skipEmptyLines: true,
            complete: r => resolve(r.data),
            error:    e => reject(e)
        });
    });
}

// ─────────────────────────────────────────────
// BUILD DATE MAP  (receipt_no → "DD/MM/YYYY")
// file2.csv rows:
//   [headerRow]  zone, receipt_no, "2026-02-23 05:28", ...
//   [productRow] "", "", "code/name", qty, price, ...
//   [subtotRow]  "", "", "", "", "", total, ...
// ─────────────────────────────────────────────
function buildDateMap(rows) {
    const map = {};
    for (const row of rows) {
        const receiptNo = (row[1] || '').trim();
        const col2      = (row[2] || '').trim();
        // Identify header row: col2 matches datetime pattern
        if (receiptNo && /^\d{4}-\d{2}-\d{2}/.test(col2)) {
            const d = new Date(col2);
            if (!isNaN(d)) {
                const label = d.toLocaleDateString('th-TH', {
                    day: '2-digit', month: '2-digit', year: 'numeric'
                });
                map[receiptNo] = label; // e.g. "23/02/2569" (BE) or we format manually
                // Keep as ISO date string for reliable sorting
                map[receiptNo] = col2.substring(0, 10); // "2026-02-23"
            }
        }
    }
    return map;
}

// ─────────────────────────────────────────────
// PARSE INVENTORY  (file1.csv)
// Columns: zone, receipt_no, code, name, bfwd, received, total, sold, waste, others, remaining
// ─────────────────────────────────────────────
function parseInventory(rows, dateMap) {
    const result = [];
    // Skip header row (row[0])
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (r.length < 11) continue;

        const receiptNo = (r[1] || '').trim();
        const code      = (r[2] || '').trim();
        const name      = (r[3] || '').trim();

        if (!receiptNo || !name) continue;

        const bfwd      = toNum(r[4]);
        const received  = toNum(r[5]);
        const sold      = toNum(r[7]);
        const waste     = toNum(r[8]);
        const remaining = toNum(r[10]);

        // Extract category from code (e.g. "1. BEV005" → "BEV005")
        const catMatch = code.match(/\d+\.\s*(\S+)/);
        const category = catMatch ? catMatch[1] : code;

        const date = dateMap[receiptNo] || 'Unknown';

        result.push({ date, receiptNo, code, category, name, bfwd, received, sold, waste, remaining });
    }
    return result;
}

function toNum(v) {
    const n = parseFloat((v || '').toString().replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
}

// ─────────────────────────────────────────────
// DATE FILTER & AGGREGATION
// ─────────────────────────────────────────────
function getUniqueDates(rows) {
    const dates = [...new Set(rows.map(r => r.date))].filter(d => d !== 'Unknown');
    return dates.sort();
}

function populateDaySelector(rows) {
    const sel = document.getElementById('day-selector');
    sel.innerHTML = '';
    const dates = getUniqueDates(rows);
    if (dates.length === 0) {
        sel.innerHTML = '<option value="">ไม่พบข้อมูล</option>';
        return;
    }
    dates.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = formatDateTH(d);
        sel.appendChild(opt);
    });
}

function applyDateFilter(selectedDate) {
    filteredRows = selectedDate
        ? allRows.filter(r => r.date === selectedDate)
        : allRows;

    updateSummaryCards(filteredRows);
    renderCharts(allRows, selectedDate);
    renderTable(filteredRows);

    const title = selectedDate
        ? `ภาพรวมสต็อกวันที่ ${formatDateTH(selectedDate)}`
        : 'ภาพรวมสต็อกทั้งหมด';
    document.getElementById('summary-title').textContent = title;
}

// ─────────────────────────────────────────────
// SUMMARY CARDS
// ─────────────────────────────────────────────
function updateSummaryCards(rows) {
    const agg = aggregate(rows);
    document.getElementById('total-received').textContent  = agg.received.toLocaleString();
    document.getElementById('total-sold').textContent      = agg.sold.toLocaleString();
    document.getElementById('total-waste').textContent     = agg.waste.toLocaleString();
    document.getElementById('total-remaining').textContent = agg.remaining.toLocaleString();
}

function aggregate(rows) {
    return rows.reduce((acc, r) => {
        acc.received  += r.received;
        acc.sold      += r.sold;
        acc.waste     += r.waste;
        acc.remaining += r.remaining;
        return acc;
    }, { received: 0, sold: 0, waste: 0, remaining: 0 });
}

// ─────────────────────────────────────────────
// CHARTS
// ─────────────────────────────────────────────
function renderCharts(rows, selectedDate) {
    renderTrendChart(rows);
    renderTopSellersChart(filterByDate(rows, selectedDate));
    renderTopWasteChart(filterByDate(rows, selectedDate));
}

function filterByDate(rows, date) {
    return date ? rows.filter(r => r.date === date) : rows;
}

function renderTrendChart(rows) {
    const dates = getUniqueDates(rows);
    const received  = dates.map(d => sumField(rows, d, 'received'));
    const sold      = dates.map(d => sumField(rows, d, 'sold'));
    const waste     = dates.map(d => sumField(rows, d, 'waste'));
    const remaining = dates.map(d => sumField(rows, d, 'remaining'));

    const labels = dates.map(formatDateTH);

    if (charts.trend) charts.trend.destroy();
    const ctx = document.getElementById('trendChart').getContext('2d');
    charts.trend = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'รับเข้า',    data: received,  borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.1)',   tension: 0.4, fill: true },
                { label: 'ขาย',        data: sold,      borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.1)',   tension: 0.4, fill: true },
                { label: 'ของเสีย',    data: waste,     borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.1)', tension: 0.4, fill: true },
                { label: 'คงเหลือ',   data: remaining, borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,0.1)',  tension: 0.4, fill: true },
            ]
        },
        options: chartOptions('แนวโน้มรายวัน')
    });
}

function renderTopSellersChart(rows) {
    const top = topProducts(rows, 'sold', 10);
    if (charts.sellers) charts.sellers.destroy();
    const ctx = document.getElementById('topProductsChart').getContext('2d');
    charts.sellers = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: top.map(p => shortName(p.name, 20)),
            datasets: [{ label: 'ยอดขาย', data: top.map(p => p.value),
                backgroundColor: 'rgba(52,211,153,0.7)', borderColor: '#34d399', borderWidth: 1 }]
        },
        options: barOptions()
    });
}

function renderTopWasteChart(rows) {
    const top = topProducts(rows, 'waste', 10);
    if (charts.waste) charts.waste.destroy();
    const ctx = document.getElementById('topWasteChart').getContext('2d');
    charts.waste = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: top.map(p => shortName(p.name, 20)),
            datasets: [{ label: 'ของเสีย', data: top.map(p => p.value),
                backgroundColor: 'rgba(248,113,113,0.7)', borderColor: '#f87171', borderWidth: 1 }]
        },
        options: barOptions()
    });
}

function topProducts(rows, field, n) {
    const map = {};
    rows.forEach(r => {
        const key = r.name;
        map[key] = (map[key] || 0) + r[field];
    });
    return Object.entries(map)
        .map(([name, value]) => ({ name, value }))
        .filter(p => p.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, n);
}

function sumField(rows, date, field) {
    return rows.filter(r => r.date === date).reduce((s, r) => s + r[field], 0);
}

function chartOptions(title) {
    return {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
            x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
    };
}

function barOptions() {
    return {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
            x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { display: false } }
        }
    };
}

// ─────────────────────────────────────────────
// TABLE
// ─────────────────────────────────────────────
function renderTable(rows) {
    const q = (document.getElementById('search-input').value || '').toLowerCase();
    let data = q
        ? rows.filter(r => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
        : rows;

    // Aggregate by name+code (multiple receipts per product)
    const aggMap = {};
    data.forEach(r => {
        const key = r.code + '|' + r.name;
        if (!aggMap[key]) {
            aggMap[key] = { ...r, _count: 1 };
        } else {
            aggMap[key].bfwd      += r.bfwd;
            aggMap[key].received  += r.received;
            aggMap[key].sold      += r.sold;
            aggMap[key].waste     += r.waste;
            aggMap[key].remaining += r.remaining;
            aggMap[key]._count++;
        }
    });

    let tableData = Object.values(aggMap);

    // Sort
    if (sortState.col) {
        tableData.sort((a, b) => {
            let av = a[sortState.col], bv = b[sortState.col];
            if (typeof av === 'string') av = av.toLowerCase();
            if (typeof bv === 'string') bv = bv.toLowerCase();
            return sortState.dir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
        });
    }

    const tbody = document.getElementById('inventory-table-body');
    if (tableData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-gray-500">ไม่พบข้อมูล</td></tr>`;
        return;
    }

    tbody.innerHTML = tableData.map(r => `
        <tr class="hover:bg-white/5 transition-colors duration-150">
            <td class="px-6 py-3 text-gray-400 text-xs font-mono">${escHtml(r.code)}</td>
            <td class="px-6 py-3 text-gray-200">${escHtml(r.name)}</td>
            <td class="px-6 py-3">
                <span class="text-xs px-2 py-1 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/20">
                    ${escHtml(r.category)}
                </span>
            </td>
            <td class="px-6 py-3 text-center text-gray-400">${r.bfwd.toLocaleString()}</td>
            <td class="px-6 py-3 text-center text-blue-400 font-medium">${r.received.toLocaleString()}</td>
            <td class="px-6 py-3 text-center text-emerald-400 font-medium">${r.sold.toLocaleString()}</td>
            <td class="px-6 py-3 text-center ${r.waste > 0 ? 'text-rose-400 font-medium' : 'text-gray-500'}">${r.waste.toLocaleString()}</td>
            <td class="px-6 py-3 text-center">
                <span class="${remainBadge(r.remaining, r.sold)}">${r.remaining.toLocaleString()}</span>
            </td>
        </tr>
    `).join('');
}

function remainBadge(remaining, sold) {
    if (remaining === 0 && sold > 0) return 'badge-danger';
    if (remaining < 10) return 'badge-warn';
    return 'badge-ok';
}

// ─────────────────────────────────────────────
// SORT
// ─────────────────────────────────────────────
const COL_MAP = {
    code: 'code', name: 'name', category: 'category',
    broughtForward: 'bfwd', received: 'received',
    sold: 'sold', waste: 'waste', remain: 'remaining'
};

function handleSort(col) {
    const field = COL_MAP[col] || col;
    if (sortState.col === field) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.col = field;
        sortState.dir = 'asc';
    }
    // Update header icons
    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.dataset.sort === col) th.classList.add(sortState.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    });
    renderTable(filteredRows);
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function showLoader(show) {
    document.getElementById('loader').classList.toggle('hidden', !show);
    document.getElementById('dashboard-content').classList.toggle('hidden', show);
}

function formatDateTH(isoDate) {
    if (!isoDate || isoDate === 'Unknown') return 'ไม่ทราบวันที่';
    const [y, m, d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
}

function escHtml(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function shortName(s, max) {
    return s && s.length > max ? s.substring(0, max) + '…' : (s || '');
}
