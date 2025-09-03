/* global Quill, XLSX */

(function () {
  // ====== Status log (concise, human-readable) ======
  const statusLog = document.getElementById('statusLog');
  function clearLog() { statusLog.value = ''; }
  function log(level, message) {
    const ts = new Date().toLocaleString();
    const niceLevel = level.toUpperCase();
    statusLog.value += (statusLog.value ? '\n' : '') + `[${ts}] [${niceLevel}] ${message}`;
    statusLog.scrollTop = statusLog.scrollHeight;
  }
  clearLog();

  // ====== Quill ======
  const quill = new Quill('#editor', {
    theme: 'snow',
    placeholder: 'Write your email…',
    modules: {
      toolbar: [
        [{ font: [] }, { size: [] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ color: [] }, { background: [] }],
        [{ script: 'sub' }, { script: 'super' }],
        [{ header: [1, 2, 3, 4, 5, 6, false] }],
        ['blockquote', 'code-block'],
        [{ list: 'ordered' }, { list: 'bullet' }, { indent: '-1' }, { indent: '+1' }],
        [{ align: [] }],
        ['link', 'image', 'video'],
        ['clean']
      ],
      clipboard: { matchVisual: false },
      history: { delay: 1000, maxStack: 100, userOnly: true }
    }
  });
  document.querySelector('#editor').style.height = '300px';

  // ====== DOM refs ======
  const formWrap = document.getElementById('formWrap');
  const verifyBtn = document.getElementById('verifyBtn');
  const verifyResult = document.getElementById('verifyResult');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const excelInput = document.getElementById('excelFile');
  const delayInput = document.getElementById('delaySec');
  const mailForm = document.getElementById('mailForm');

  // ====== State ======
  let workbook = null;
  let sheetName = null;
  let rows = [];
  let verified = false;
  let sending = false;
  let stopRequested = false;
  let currentAbort = null; // AbortController for in-flight fetch

  // ====== Utils ======
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function getVal(id) { return document.getElementById(id).value; }
  function getTrim(id) { return document.getElementById(id).value.trim(); }
  function pad2(n){ return String(n).padStart(2,'0'); }
  function timeStampForName(){
    const d=new Date();
    return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  }

  function setUIBusy(busy) {
    const controls = mailForm.querySelectorAll('input, select, textarea, button, a');
    controls.forEach(el => {
      if (busy) {
        if (el === stopBtn) el.disabled = false;
        else el.disabled = true;
      } else {
        el.disabled = false;
      }
    });
    if (busy) {
      formWrap.classList.add('opacity-50');
      stopBtn.disabled = false;
    } else {
      formWrap.classList.remove('opacity-50');
    }
  }

  function ensureMinDelaySec() {
    const n = parseInt(delayInput.value, 10);
    if (isNaN(n) || n < 5) {
      delayInput.value = 5;
      log('info', 'Delay adjusted to 5 seconds (minimum).');
      return 5;
    }
    return n;
  }

  function extractPlaceholders(text) {
    const regex = /{{\s*([A-Za-z0-9_\- ]+)\s*}}/g;
    const found = new Set();
    if (!text) return [];
    let m;
    while ((m = regex.exec(text)) !== null) found.add(m[1].trim());
    return Array.from(found);
  }

  function applyPlaceholders(str, row) {
    if (!str) return '';
    return str.replace(/{{\s*([A-Za-z0-9_\- ]+)\s*}}/g, (_, keyRaw) => {
      const key = keyRaw.trim();
      const val = row[key];
      if (val === undefined || val === null || String(val).trim() === '') {
        throw new Error(`Missing value for {{${key}}}.`);
      }
      return String(val);
    });
  }

  function arrayBufferFromFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('File read error'));
      fr.readAsArrayBuffer(file);
    });
  }

  // NEW: Show headers only after verify
  function renderVerifySummary({ rowCount, addedCols, headers }) {
    verifyResult.innerHTML = `
      <div><strong>Rows:</strong> ${rowCount}</div>
      <div><strong>Headers:</strong> ${headers.length ? headers.join(', ') : '(none)'}</div>
      <div><strong>Added columns:</strong> ${addedCols.length ? addedCols.join(', ') : 'none'}</div>
    `;
  }

  function createDownloadLink() {
    if (!workbook || !sheetName) return;
    const ws = XLSX.utils.json_to_sheet(rows, { skipHeader: false });
    workbook.Sheets[sheetName] = ws;
    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    // Name with date & time, using original filename base if available
    const original = (excelInput.files && excelInput.files[0]) ? excelInput.files[0].name : 'updated.xlsx';
    const base = original.replace(/\.[^.]+$/,'');
    const filename = `${base}-${timeStampForName()}.xlsx`;

    const url = URL.createObjectURL(blob);
    downloadBtn.href = url;
    downloadBtn.setAttribute('download', filename);
    downloadBtn.classList.remove('d-none');
  }
  function hideDownloadLink() {
    downloadBtn.classList.add('d-none');
    downloadBtn.removeAttribute('href');
  }

  // Attachments -> Nodemailer format
  function readAttachments(inputEl) {
    const files = Array.from(inputEl.files || []);
    if (!files.length) return Promise.resolve([]);
    return Promise.all(files.map(file =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result);
          const base64 = result.split(',')[1];
          resolve({
            filename: file.name,
            content: base64,
            encoding: 'base64',
            contentType: file.type || undefined,
          });
        };
        reader.onerror = () => reject(reader.error || new Error('Attachment read error'));
        reader.readAsDataURL(file);
      })
    ));
  }

  // ====== ERROR EXTRACTION HELPER (new) ======
  async function extractError(res) {
    let data;
    try { data = await res.clone().json(); } catch (_) { /* ignore non-JSON */ }

    const apiMsg = data?.data?.error || data?.message;
    const apiDetails = data?.data?.details;
    const statusLine = `HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''}`;

    if (apiMsg && apiDetails) return `${apiMsg} (${apiDetails})`;
    if (apiMsg) return `${apiMsg} (${statusLine})`;

    let textPreview = '';
    try {
      const t = await res.text();
      textPreview = t ? ` | ${String(t).slice(0,140)}…` : '';
    } catch (_) {}

    return `Send failed. ${statusLine}${textPreview}`;
  }

  // ====== Verify flow ======
  excelInput.addEventListener('change', () => {
    verified = false;
    hideDownloadLink();
    verifyResult.innerHTML = `<div class="text-muted">File chosen. Click "Verify".</div>`;
    log('info', 'Excel selected. Verification required.');
    // NEW: allow verifying this new file
    verifyBtn.disabled = false;
  });

  verifyBtn.addEventListener('click', async () => {
    const file = excelInput.files && excelInput.files[0];
    if (!file) {
      verified = false;
      verifyResult.innerHTML = `<div class="text-muted">No file selected.</div>`;
      log('warning', 'No Excel selected to verify.');
      return;
    }

    try {
      const buf = await arrayBufferFromFile(file);
      workbook = XLSX.read(buf, { type: 'array' });
      sheetName = workbook.SheetNames[0];
      const ws = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!Array.isArray(rows)) rows = [];

      // Gather columns from data
      const columns = new Set();
      rows.forEach(r => Object.keys(r).forEach(k => columns.add(k)));

      // Ensure Timestamp & Status columns exist everywhere
      const ensureCols = ['Timestamp', 'Status'];
      const addedCols = [];
      ensureCols.forEach(k => {
        if (!columns.has(k)) addedCols.push(k);
        columns.add(k);
      });
      rows = rows.map(r => ({ ...r, Timestamp: r.Timestamp || '', Status: r.Status || '' }));

      // Prepare headers list *after* ensuring added columns
      const headers = Array.from(columns);

      // Show summary with headers (only after Verify)
      renderVerifySummary({ rowCount: rows.length, addedCols, headers });

      verified = true;
      hideDownloadLink();
      log('success', `Verified ${rows.length} row(s).`);

      // NEW: disable verify button after successful verification
      verifyBtn.disabled = true;

    } catch (err) {
      verified = false;
      log('error', `Verify failed: ${err.message || String(err)}`);
      verifyResult.innerHTML = `<div class="text-danger">Verify failed: ${err.message || String(err)}</div>`;
      // Keep verify button enabled so they can retry
      verifyBtn.disabled = false;
    }
  });

  // ====== Start/Stop sending ======
  startBtn.addEventListener('click', async () => {
    // Credentials
    const user = getTrim('user');
    const pass = getVal('pass');
    if (!user || !pass) {
      log('error', 'Please enter Gmail address and app password.');
      return;
    }

    const delaySec = ensureMinDelaySec();
    const usingExcel = !!(excelInput.files && excelInput.files[0]);
    if (usingExcel && !verified) {
      log('error', 'Excel selected: please run Verify first.');
      return;
    }

    // Attachments once
    let attachments;
    try {
      attachments = await readAttachments(document.getElementById('attachments'));
    } catch (e) {
      log('error', e.message || 'Attachment read failed.');
      return;
    }

    // Templates (<p> -> <div>)
    const rawBody = document.querySelector('#editor .ql-editor').innerHTML;
    const htmlTemplate = rawBody.replace(/<p>/g, '<div>').replace(/<\/p>/g, '</div>');
    const subjectTemplate = getVal('subject') || '';

    stopRequested = false;
    sending = true;
    setUIBusy(true);
    startBtn.disabled = true;
    stopBtn.disabled = false;
    log('info', 'Sending started.');

    try {
      if (usingExcel) {
        // Bulk mode
        for (let i = 0; i < rows.length; i++) {
          if (stopRequested) { log('warning', 'Stopped by user.'); break; }

          const row = rows[i];

          // Skip already-success rows
          if ((row.Status || '').toString().toLowerCase() === 'success') {
            log('info', `Row ${i + 1}: skipped (already sent).`);
            continue;
          }

          try {
            // Resolve recipient
            let toValue = '';
            if (/{{\s*To\s*}}/.test(subjectTemplate) || /{{\s*To\s*}}/.test(htmlTemplate)) {
              if (!row.To || String(row.To).trim() === '') {
                throw new Error('Missing "To" value in Excel for this row.');
              }
              toValue = String(row.To).trim();
            } else if (row.To && String(row.To).trim() !== '') {
              toValue = String(row.To).trim();
            } else {
              const singleTo = getTrim('to');
              if (!singleTo) throw new Error('No "To" address provided.');
              toValue = singleTo;
            }

            // Merge placeholders (throws if any are missing)
            const subject = applyPlaceholders(subjectTemplate, row);
            const html = applyPlaceholders(htmlTemplate, row);
            const text = quill.getText();

            // Timestamp attempt
            row.Timestamp = new Date().toISOString();

            // Send
            const payload = {
              user, pass,
              to: toValue,
              cc: getTrim('cc') || undefined,
              bcc: getTrim('bcc') || undefined,
              subject, text, html, attachments
            };

            currentAbort = new AbortController();
            const res = await fetch('/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: currentAbort.signal
            });

            if (!res.ok) {
              const msg = await extractError(res);
              row.Status = msg;
              log('error', `Row ${i + 1}: ${msg}`);
              stopRequested = true; // stop immediately on any error
              break;
            } else {
              const data = await res.json().catch(() => ({}));
              const id = data?.data?.messageId ?? '(no id)';
              row.Status = 'Success';
              log('success', `Row ${i + 1}: sent (Message ID: ${id}).`);
            }
          } catch (err) {
            if (err && err.name === 'AbortError') {
              row.Status = 'Stopped by user';
              log('warning', `Row ${i + 1}: request aborted.`);
              stopRequested = true;
              break;
            }
            if (!row.Timestamp) row.Timestamp = new Date().toISOString();
            row.Status = err.message || String(err);
            log('error', `Row ${i + 1}: ${row.Status}`);
            stopRequested = true; // instant stop on any error
            break;
          } finally {
            currentAbort = null;
          }

          // Pause between emails (single concise message)
          if (!stopRequested && i < rows.length - 1) {
            log('info', `Pausing ${delaySec}s before next email...`);
            const end = Date.now() + delaySec * 1000;
            // light abort-aware pause (no per-second spam)
            while (!stopRequested && Date.now() < end) {
              await sleep(250);
            }
            if (stopRequested) { log('warning', 'Stopped during pause.'); break; }
          }
        }

        // Provide updated workbook
        createDownloadLink();

      } else {
        // Single mode
        try {
          const singleTo = getTrim('to');
          if (!singleTo) throw new Error('Please enter a recipient address.');

          const payload = {
            user, pass,
            to: singleTo,
            cc: getTrim('cc') || undefined,
            bcc: getTrim('bcc') || undefined,
            subject: subjectTemplate,
            text: quill.getText(),
            html: htmlTemplate,
            attachments
          };

          currentAbort = new AbortController();
          const res = await fetch('/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: currentAbort.signal
          });

          if (!res.ok) {
            const msg = await extractError(res);
            log('error', msg);
            stopRequested = true;
          } else {
            const data = await res.json().catch(() => ({}));
            const id = data?.data?.messageId ?? '(no id)';
            log('success', `Sent (Message ID: ${id}).`);
          }
        } catch (err) {
          if (err && err.name === 'AbortError') {
            log('warning', 'Request aborted.');
          } else {
            log('error', err.message || String(err));
          }
        } finally {
          currentAbort = null;
        }
      }

    } catch (outerErr) {
      log('error', outerErr.message || String(outerErr));
      createDownloadLink(); // whatever progress we have
    } finally {
      sending = false;
      setUIBusy(false);
      startBtn.disabled = false;
      stopBtn.disabled = true;
      log('info', stopRequested ? 'Sending stopped.' : 'All done.');
    }
  });

  // Instant stop: abort current fetch and set flag
  stopBtn.addEventListener('click', () => {
    if (!sending) return;
    stopRequested = true;
    if (currentAbort) {
      try { currentAbort.abort(); } catch (_) {}
    }
    log('warning', 'Stop requested.');
  });
})();
