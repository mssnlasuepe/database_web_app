// ============================================================
//  MSSN Alumni Database — app.js
//  Handles: CSV upload, localStorage, search/filter, 
//           suggestions, edit modal, export
// ============================================================

const STORAGE_KEY_DB         = 'mssn_db_data';
const STORAGE_KEY_SUBS       = 'mssn_suggestions';
const STORAGE_KEY_CHECKSUM   = 'mssn_db_checksum';
const STORAGE_KEY_PREV_COUNT = 'mssn_db_prev_count';

// --- State ---
let db = [];
let filteredDb = [];
let suggestions = [];

// --- DOM Refs ---
const uploadScreen      = document.getElementById('upload-screen');
const appScreen         = document.getElementById('app-screen');
const dropZone          = document.getElementById('drop-zone');
const fileInput         = document.getElementById('file-input');
const uploadError       = document.getElementById('upload-error');

const searchInput       = document.getElementById('search-input');
const clearSearch       = document.getElementById('clear-search');
const setFilter         = document.getElementById('set-filter');
const genderFilter      = document.getElementById('gender-filter');
const deptFilter        = document.getElementById('dept-filter');
const resetFiltersBtn   = document.getElementById('reset-filters');
const exportFormat      = document.getElementById('export-format');
const exportFilteredBtn = document.getElementById('export-filtered-btn');

const tableBody         = document.getElementById('table-body');
const totalCountEl      = document.getElementById('total-count');
const noResults         = document.getElementById('no-results');
const resultInfo        = document.getElementById('result-info');
const clearFiltersBtn   = document.getElementById('clear-filters-btn');
const headerSubtitle    = document.getElementById('header-subtitle');

const suggestionsBtn    = document.getElementById('suggestions-btn');
const suggestionsBadge  = document.getElementById('suggestions-badge');
const suggestionsPanel  = document.getElementById('suggestions-panel');
const suggestionsOverlay= document.getElementById('suggestions-overlay');
const closePanelBtn     = document.getElementById('close-panel-btn');
const suggestionsList   = document.getElementById('suggestions-list');
const exportSugBtn      = document.getElementById('export-suggestions-btn');
const clearSugBtn       = document.getElementById('clear-suggestions-btn');

const modalOverlay      = document.getElementById('modal-overlay');
const editModal         = document.getElementById('edit-modal');
const modalTitle        = document.getElementById('modal-title');
const closeModalBtn     = document.getElementById('close-modal-btn');
const cancelModalBtn    = document.getElementById('cancel-modal-btn');
const saveModalBtn      = document.getElementById('save-suggestion-btn');
const addRecordFab      = document.getElementById('add-record-fab');
const changeDbBtn       = document.getElementById('change-db-btn');

// Modal fields
const mId     = document.getElementById('modal-record-id');
const mName   = document.getElementById('modal-name');
const mGender = document.getElementById('modal-gender');
const mSet    = document.getElementById('modal-set');
const mDept   = document.getElementById('modal-dept');
const mPhones = document.getElementById('modal-phones');
const mAlt    = document.getElementById('modal-alt');
const mEmail  = document.getElementById('modal-email');
const mNote   = document.getElementById('modal-note');

// ============================================================
//  CSV PARSING
// ============================================================
function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) throw new Error('CSV file appears to be empty.');

    const header = parseCSVLine(lines[0]);
    const required = ['id', 'name', 'gender'];
    for (const col of required) {
        if (!header.includes(col)) throw new Error(`Missing required column: "${col}". Make sure you upload combined_database.csv.`);
    }

    const records = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseCSVLine(line);
        const record = {};
        header.forEach((col, idx) => { record[col] = (values[idx] || '').trim(); });
        if (record.name) records.push(record);
    }

    if (records.length === 0) throw new Error('No records found in the CSV.');
    return records;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current);
    return result;
}

// ============================================================
//  CHECKSUM  (SHA-256 via Web Crypto API)
// ============================================================
async function computeChecksum(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function showToast(message, type = 'info') {
    // Remove existing toast if any
    const existing = document.getElementById('checksum-toast');
    if (existing) existing.remove();

    const colors = {
        info:    { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.35)', icon: 'bx-check-circle',    color: '#34d399' },
        warning: { bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.35)', icon: 'bx-info-circle',     color: '#fbbf24' },
        same:    { bg: 'rgba(56,189,248,0.10)', border: 'rgba(56,189,248,0.30)', icon: 'bx-copy',            color: '#7dd3fc' },
    };
    const c = colors[type] || colors.info;

    const toast = document.createElement('div');
    toast.id = 'checksum-toast';
    toast.style.cssText = `
        position: fixed; bottom: 5rem; left: 50%; transform: translateX(-50%);
        background: ${c.bg}; border: 1px solid ${c.border};
        color: ${c.color}; padding: 0.8rem 1.4rem;
        border-radius: 12px; font-size: 0.9rem; font-weight: 500;
        display: flex; align-items: center; gap: 0.6rem;
        backdrop-filter: blur(20px); z-index: 200;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        animation: toastIn 0.3s ease;
    `;
    toast.innerHTML = `<i class='bx ${c.icon}' style="font-size:1.1rem"></i>${message}`;
    document.body.appendChild(toast);

    // Auto-remove after 4s
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.4s'; setTimeout(() => toast.remove(), 400); }, 4000);
}

// Inject toast animation into head once
(() => {
    const style = document.createElement('style');
    style.textContent = `@keyframes toastIn { from { opacity:0; transform: translateX(-50%) translateY(10px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }`;
    document.head.appendChild(style);
})();

// ============================================================
//  INIT: Try loading from localStorage first
// ============================================================
function init() {
    suggestions = JSON.parse(localStorage.getItem(STORAGE_KEY_SUBS) || '[]');

    const raw = localStorage.getItem(STORAGE_KEY_DB);
    if (raw) {
        try {
            db = JSON.parse(raw);
            if (db.length > 0) {
                showApp({ type: 'init', newCount: db.length });
                return;
            }
        } catch(e) {
            localStorage.removeItem(STORAGE_KEY_DB);
        }
    }
    showUpload();
}

function showUpload() {
    uploadScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
    addRecordFab.classList.add('hidden');
}

function showApp(status = { type: 'init', newCount: 0 }) {
    uploadScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    addRecordFab.classList.remove('hidden');
    initDropdowns();
    updateSuggestionsBadge();
    filterAndRender();

    const n = status.newCount || db.length;
    const old = status.oldCount;

    let subtitle = '';
    if (status.type === 'same') {
        subtitle = `No changes detected · ${n.toLocaleString()} records`;
        headerSubtitle.style.color = 'var(--mssn-green)';
    } else if (status.type === 'updated') {
        subtitle = `Updated: ${(old || 0).toLocaleString()} (old) → ${n.toLocaleString()} (new) records`;
        headerSubtitle.style.color = '#fbbf24'; // amber
    } else {
        subtitle = `${n.toLocaleString()} records loaded`;
        headerSubtitle.style.color = 'var(--text-secondary)';
    }

    headerSubtitle.textContent = subtitle;
}

// ============================================================
//  UPLOAD HANDLERS
// ============================================================
async function handleFileLoad(file) {
    if (!file || !file.name.endsWith('.csv')) {
        showUploadError('Please select a valid .csv file.');
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const rawText = e.target.result;

            // ── Checksum comparison ──────────────────────────
            const newChecksum  = await computeChecksum(rawText);
            const prevChecksum = localStorage.getItem(STORAGE_KEY_CHECKSUM) || '';
            const prevCount    = parseInt(localStorage.getItem(STORAGE_KEY_PREV_COUNT) || '0', 10);

            // ── Parse & store ───────────────────────────────
            db = parseCSV(rawText);
            const newCount = db.length;

            localStorage.setItem(STORAGE_KEY_DB, JSON.stringify(db));
            localStorage.setItem(STORAGE_KEY_CHECKSUM, newChecksum);
            localStorage.setItem(STORAGE_KEY_PREV_COUNT, String(newCount));
            uploadError.classList.add('hidden');

            // ── Build status for subtitle ────────────────────
            let status;
            if (prevChecksum && newChecksum === prevChecksum) {
                status = { type: 'same', newCount };
            } else if (prevChecksum && newChecksum !== prevChecksum) {
                status = { type: 'updated', newCount, oldCount: prevCount };
            } else {
                status = { type: 'init', newCount };
            }

            showApp(status);
        } catch (err) {
            showUploadError(err.message);
        }
    };
    reader.readAsText(file);
}

function showUploadError(msg) {
    uploadError.textContent = msg;
    uploadError.classList.remove('hidden');
}

// Drag & drop
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragging'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragging');
    handleFileLoad(e.dataTransfer.files[0]);
});
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => handleFileLoad(e.target.files[0]));

// Change DB button — also restore checksum display on upload screen
changeDbBtn.addEventListener('click', () => {
    const prevChecksum = localStorage.getItem(STORAGE_KEY_CHECKSUM);
    const hint = prevChecksum ? `Previous database checksum: sha256:${prevChecksum.slice(0, 8)}…` : '';
    localStorage.removeItem(STORAGE_KEY_DB);
    db = [];
    showUpload();
    if (hint) {
        // Show the old checksum as a subtle hint on the upload screen
        const p = document.createElement('p');
        p.style.cssText = 'font-size:0.8rem;color:var(--text-muted);margin-top:0.5rem;font-family:monospace;';
        p.textContent = hint;
        const card = document.querySelector('.upload-card');
        // Remove any old hint
        card.querySelectorAll('.checksum-hint').forEach(el => el.remove());
        p.className = 'checksum-hint';
        card.appendChild(p);
    }
});

// ============================================================
//  DROPDOWNS
// ============================================================
function initDropdowns() {
    const sets = new Set();
    const depts = new Set();

    db.forEach(r => {
        if (r.set) sets.add(r.set);
        if (r.department) {
            r.department.split(/[\/,]/).forEach(d => {
                const t = d.trim();
                if (t) depts.add(t);
            });
        }
    });

    // Clear and re-populate SET
    setFilter.innerHTML = '<option value="">All Sets</option>';
    const sortedSets = Array.from(sets).sort((a, b) => {
        if (a === 'Unknown') return 1;
        if (b === 'Unknown') return -1;
        return a.localeCompare(b, undefined, { numeric: true });
    });
    sortedSets.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s === 'Unknown' ? 'Unknown' : `Set ${s}`;
        setFilter.appendChild(opt);
    });

    // Clear and re-populate Departments
    deptFilter.innerHTML = '<option value="">All Departments</option>';
    Array.from(depts).sort().forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        deptFilter.appendChild(opt);
    });
}

// ============================================================
//  SEARCH & FILTER
// ============================================================
function filterAndRender() {
    const q = searchInput.value.toLowerCase().trim();
    const selSet = setFilter.value;
    const selGender = genderFilter.value;
    const selDept = deptFilter.value.toLowerCase();

    filteredDb = db.filter(r => {
        if (selSet && r.set !== selSet) return false;
        if (selGender && r.gender !== selGender) return false;
        if (selDept && !(r.department || '').toLowerCase().includes(selDept)) return false;
        if (q) {
            return (
                (r.name || '').toLowerCase().includes(q) ||
                (r.phones || '').includes(q) ||
                (r.alt_number || '').includes(q) ||
                (r.email || '').toLowerCase().includes(q) ||
                (r.source_file || '').toLowerCase().includes(q) ||
                (r.id || '').toLowerCase().includes(q)
            );
        }
        return true;
    });

    renderTable(filteredDb);
    totalCountEl.textContent = filteredDb.length.toLocaleString();

    // Clear search X button
    clearSearch.classList.toggle('hidden', !q);
}

searchInput.addEventListener('input', filterAndRender);
setFilter.addEventListener('change', filterAndRender);
genderFilter.addEventListener('change', filterAndRender);
deptFilter.addEventListener('change', filterAndRender);
clearSearch.addEventListener('click', () => { searchInput.value = ''; filterAndRender(); searchInput.focus(); });
resetFiltersBtn.addEventListener('click', () => {
    searchInput.value = ''; setFilter.value = '';
    genderFilter.value = ''; deptFilter.value = '';
    filterAndRender();
});
clearFiltersBtn.addEventListener('click', () => {
    searchInput.value = ''; setFilter.value = '';
    genderFilter.value = ''; deptFilter.value = '';
    filterAndRender();
});

exportFilteredBtn.addEventListener('click', () => {
    if (filteredDb.length === 0) {
        showToast('No records to export!', 'warning');
        return;
    }

    const format = exportFormat.value;
    const ts = new Date().toISOString().slice(0, 10);
    const columns = ['id', 'name', 'gender', 'department', 'phones', 'alt_number', 'email', 'set', 'source_file'];
    
    let content, mimeType, ext;

    if (format === 'json') {
        // Only export the specified columns
        const exportData = filteredDb.map(r => {
            const obj = {};
            columns.forEach(col => obj[col] = r[col] || '');
            return obj;
        });
        content = JSON.stringify(exportData, null, 2);
        mimeType = 'application/json';
        ext = 'json';
    } else if (format === 'xlsx') {
        const exportData = filteredDb.map(r => {
            const obj = {};
            columns.forEach(col => obj[col] = r[col] || '');
            return obj;
        });
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "MSSN Alumni");
        
        let fname = 'mssn_export';
        if (setFilter.value) fname += `_Set${setFilter.value}`;
        if (genderFilter.value) fname += `_${genderFilter.value}`;
        if (deptFilter.value) fname += `_${deptFilter.value.replace(/[^a-zA-Z0-9]/g, '')}`;
        if (searchInput.value) fname += '_Filtered';
        fname += `_${ts}.xlsx`;
        
        XLSX.writeFile(workbook, fname);
        showToast(`Exported ${filteredDb.length.toLocaleString()} records as EXCEL!`, 'info');
        return; // Early return because SheetJS handles the download itself
    } else if (format === 'md') {
        // Markdown Export
        let md = `# MSSN Alumni Export\n\n`;
        md += `*Generated on ${ts}*\n\n`;
        md += `| ` + columns.map(c => c.toUpperCase()).join(' | ') + ` |\n`;
        md += `| ` + columns.map(() => '---').join(' | ') + ` |\n`;
        
        filteredDb.forEach(r => {
            const row = columns.map(col => {
                let val = r[col] || '';
                val = val.replace(/\|/g, '\\|'); // Escape markdown pipes
                return val;
            });
            md += `| ` + row.join(' | ') + ` |\n`;
        });
        content = md;
        mimeType = 'text/markdown;charset=utf-8;';
        ext = 'md';
    } else {
        // CSV Export
        let csvContent = columns.join(',') + '\n';
        filteredDb.forEach(r => {
            const row = columns.map(col => {
                let val = r[col] || '';
                val = val.replace(/"/g, '""');
                if (val.includes(',') || val.includes('"')) {
                    val = `"${val}"`;
                }
                return val;
            });
            csvContent += row.join(',') + '\n';
        });
        content = csvContent;
        mimeType = 'text/csv;charset=utf-8;';
        ext = 'csv';
    }

    // Build descriptive filename for text-based downloads
    let filename = 'mssn_export';
    if (setFilter.value) filename += `_Set${setFilter.value}`;
    if (genderFilter.value) filename += `_${genderFilter.value}`;
    if (deptFilter.value) filename += `_${deptFilter.value.replace(/[^a-zA-Z0-9]/g, '')}`;
    if (searchInput.value) filename += '_Filtered';
    filename += `_${ts}.${ext}`;

    // Create and trigger download
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast(`Exported ${filteredDb.length.toLocaleString()} records as ${ext.toUpperCase()}!`, 'info');
});

// ============================================================
//  RENDER TABLE
// ============================================================
const PAGE_SIZE = 250;

function renderTable(data) {
    tableBody.innerHTML = '';
    const tableEl = document.getElementById('data-table');

    if (data.length === 0) {
        tableEl.style.display = 'none';
        noResults.classList.remove('hidden');
        resultInfo.classList.add('hidden');
        return;
    }

    tableEl.style.display = 'table';
    noResults.classList.add('hidden');

    const pageData = data.slice(0, PAGE_SIZE);

    pageData.forEach(r => {
        const tr = document.createElement('tr');

        const setLabel = r.set === 'Unknown' ? 'Unknown' : `Set ${r.set}`;
        const genderChip = r.gender === 'Brothers'
            ? `<span class="chip chip-blue">♂ Brothers</span>`
            : `<span class="chip chip-green">♀ Sisters</span>`;

        const contactHTML = buildContactHTML(r);
        const sourceHTML = buildSourceHTML(r.source_file);

        tr.innerHTML = `
            <td class="id-cell">${r.id || ''}</td>
            <td class="name-cell">${r.name || ''}</td>
            <td class="set-col">
                <span class="chip chip-grey">${setLabel}</span>
                ${genderChip}
            </td>
            <td>${r.department || '<span style="color:var(--text-muted)">—</span>'}</td>
            <td>${contactHTML}</td>
            <td class="source-cell">${sourceHTML}</td>
            <td class="action-cell">
                <button class="suggest-btn" data-id="${r.id}">
                    <i class='bx bx-edit-alt'></i> Edit
                </button>
            </td>
        `;
        tableBody.appendChild(tr);
    });

    // Result info
    if (data.length > PAGE_SIZE) {
        resultInfo.textContent = `Showing ${PAGE_SIZE.toLocaleString()} of ${data.length.toLocaleString()} records. Refine your search to see more.`;
        resultInfo.classList.remove('hidden');
    } else {
        resultInfo.classList.add('hidden');
    }

    // Attach suggest edit handlers
    tableBody.querySelectorAll('.suggest-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditModal(btn.dataset.id));
    });
}

function buildContactHTML(r) {
    let html = '<div class="contact-info">';
    const addPhone = (num, tag) => {
        if (num && num !== '—' && num !== '-') {
            html += `<div class="contact-item"><i class='bx bx-phone'></i>${num}${tag ? ` <span class="tag">${tag}</span>` : ''}</div>`;
        }
    };
    (r.phones || '').split('/').map(p => p.trim()).filter(p => p && p !== '—').forEach(p => addPhone(p, ''));
    (r.alt_number || '').split('/').map(p => p.trim()).filter(p => p && p !== '—').forEach(p => addPhone(p, 'alt'));
    if (r.email) html += `<div class="contact-item"><i class='bx bx-envelope'></i>${r.email}</div>`;
    if (!r.phones && !r.alt_number && !r.email) html += `<span style="color:var(--text-muted);font-size:0.85rem">No contact</span>`;
    html += '</div>';
    return html;
}

function buildSourceHTML(source) {
    if (!source) return '<span style="color:var(--text-muted)">—</span>';
    return source.split('|').map(s => `<div class="source-entry">${s.trim()}</div>`).join('');
}

// ============================================================
//  SUGGESTIONS PANEL
// ============================================================
function saveSuggestions() {
    localStorage.setItem(STORAGE_KEY_SUBS, JSON.stringify(suggestions));
}

function updateSuggestionsBadge() {
    const count = suggestions.length;
    suggestionsBadge.textContent = count;
    suggestionsBadge.classList.toggle('hidden', count === 0);
    exportSugBtn.disabled = count === 0;
    clearSugBtn.disabled = count === 0;
}

function renderSuggestions() {
    if (suggestions.length === 0) {
        suggestionsList.innerHTML = `
            <div class="empty-state small">
                <i class='bx bx-inbox'></i>
                <p>No suggestions yet.</p>
            </div>`;
        return;
    }

    suggestionsList.innerHTML = '';
    suggestions.forEach((s, idx) => {
        const card = document.createElement('div');
        const typeClass = s.type === 'EDIT' ? 'edit' : 'add';
        const typeLabel = s.type === 'EDIT' ? '✏ Edit' : '+ Add';
        const name = s.type === 'EDIT' ? (s.proposed.name || s.original.name) : s.proposed.name;
        const detail = s.type === 'EDIT'
            ? `ID: ${s.id} • ${s.proposed.set || s.original.set || '?'} • ${s.proposed.gender || s.original.gender || '?'}`
            : `New record • ${s.proposed.set || '?'} • ${s.proposed.gender || '?'}`;

        card.className = `suggestion-card ${typeClass}`;
        card.innerHTML = `
            <span class="type-badge">${typeLabel}</span>
            <div class="sug-name">${name}</div>
            <div class="sug-detail">${detail}</div>
            ${s.note ? `<div class="sug-detail" style="margin-top:0.4rem;font-style:italic">"${s.note}"</div>` : ''}
            <button class="sug-remove" data-idx="${idx}" title="Remove suggestion"><i class='bx bx-trash'></i></button>
        `;
        suggestionsList.appendChild(card);
    });

    suggestionsList.querySelectorAll('.sug-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            suggestions.splice(parseInt(btn.dataset.idx), 1);
            saveSuggestions();
            updateSuggestionsBadge();
            renderSuggestions();
        });
    });
}

suggestionsBtn.addEventListener('click', () => {
    renderSuggestions();
    suggestionsPanel.classList.remove('hidden');
    suggestionsOverlay.classList.remove('hidden');
});
closePanelBtn.addEventListener('click', closePanel);
suggestionsOverlay.addEventListener('click', closePanel);
function closePanel() {
    suggestionsPanel.classList.add('hidden');
    suggestionsOverlay.classList.add('hidden');
}

clearSugBtn.addEventListener('click', () => {
    if (confirm('Clear all pending suggestions? This cannot be undone.')) {
        suggestions = [];
        saveSuggestions();
        updateSuggestionsBadge();
        renderSuggestions();
    }
});

exportSugBtn.addEventListener('click', () => {
    const ts = new Date().toISOString().slice(0, 10);
    
    let edits = 0, adds = 0;
    suggestions.forEach(s => {
        if (s.type === 'EDIT') edits++;
        if (s.type === 'ADD') adds++;
    });
    
    let filename = `mssn_suggestions`;
    if (edits > 0) filename += `_${edits}edits`;
    if (adds > 0) filename += `_${adds}adds`;
    filename += `_${ts}.json`;

    const blob = new Blob([JSON.stringify(suggestions, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast(`Exported ${suggestions.length} suggestions as JSON`, 'info');
});

// ============================================================
//  EDIT MODAL
// ============================================================
function openEditModal(id) {
    const record = db.find(r => r.id === id);
    if (!record) return;

    modalTitle.textContent = 'Suggest Edit';
    mId.value = id;
    
    // Check if there is an existing edit suggestion for this ID to pre-populate
    const existing = suggestions.find(s => s.type === 'EDIT' && s.id === id);
    if (existing) {
        mName.value   = existing.proposed.name || '';
        mGender.value = existing.proposed.gender || 'Brothers';
        mSet.value    = existing.proposed.set || '';
        mDept.value   = existing.proposed.department || '';
        mPhones.value = existing.proposed.phones || '';
        mAlt.value    = existing.proposed.alt_number || '';
        mEmail.value  = existing.proposed.email || '';
        mNote.value   = existing.note || '';
    } else {
        mName.value   = record.name || '';
        mGender.value = record.gender || 'Brothers';
        mSet.value    = record.set || '';
        mDept.value   = record.department || '';
        mPhones.value = record.phones || '';
        mAlt.value    = record.alt_number || '';
        mEmail.value  = record.email || '';
        mNote.value   = '';
    }

    showModal();
}

function openAddModal() {
    modalTitle.textContent = 'Add New Record';
    mId.value = '';
    mName.value = mGender.value = mSet.value = mDept.value
        = mPhones.value = mAlt.value = mEmail.value = mNote.value = '';

    showModal();
}

function showModal() {
    editModal.classList.remove('hidden');
    modalOverlay.classList.remove('hidden');
    setTimeout(() => mName.focus(), 50);
}

function closeModal() {
    editModal.classList.add('hidden');
    modalOverlay.classList.add('hidden');
}

closeModalBtn.addEventListener('click', closeModal);
cancelModalBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', closeModal);
addRecordFab.addEventListener('click', openAddModal);

saveModalBtn.addEventListener('click', () => {
    const name = mName.value.trim();
    if (!name) { mName.focus(); mName.style.borderColor = '#f87171'; return; }
    mName.style.borderColor = '';

    const proposed = {
        name,
        gender:     mGender.value,
        set:        mSet.value.trim(),
        department: mDept.value.trim(),
        phones:     mPhones.value.trim(),
        alt_number: mAlt.value.trim(),
        email:      mEmail.value.trim(),
    };

    const id = mId.value;
    if (id) {
        const original = db.find(r => r.id === id);
        const existingIdx = suggestions.findIndex(s => s.type === 'EDIT' && s.id === id);
        const suggestionObj = {
            type: 'EDIT',
            id,
            original: { ...original },
            proposed,
            note: mNote.value.trim(),
            timestamp: new Date().toISOString()
        };
        if (existingIdx !== -1) {
            suggestions[existingIdx] = suggestionObj;
        } else {
            suggestions.push(suggestionObj);
        }
    } else {
        const existingIdx = suggestions.findIndex(s => s.type === 'ADD' && s.proposed.name.toLowerCase() === name.toLowerCase());
        const suggestionObj = {
            type: 'ADD',
            proposed,
            note: mNote.value.trim(),
            timestamp: new Date().toISOString()
        };
        if (existingIdx !== -1) {
            suggestions[existingIdx] = suggestionObj;
        } else {
            suggestions.push(suggestionObj);
        }
    }

    saveSuggestions();
    updateSuggestionsBadge();
    closeModal();

    // Flash the suggestions button
    suggestionsBtn.style.borderColor = 'var(--mssn-green)';
    setTimeout(() => suggestionsBtn.style.borderColor = '', 800);
});

// ============================================================
//  BOOTSTRAP
// ============================================================
init();
