// check.js
// Handles the "Check" action for Gmail address + App Password and renders counts under the inputs

(function () {
  // ---- small DOM helpers (kept local to this file) ----
  const byId = (id) => document.getElementById(id);
  const getVal = (id) => (byId(id)?.value ?? '');
  const getTrim = (id) => getVal(id).trim();

  // Elements (resolved after DOMContentLoaded for safety)
  let checkBtn, checkResult;

  function setPending() {
    checkResult.classList.remove('text-danger', 'text-body');
    checkResult.classList.add('text-muted');
    checkResult.textContent = 'Checking…';
  }

  function renderCheckSuccess({ sent_email_count, total_receipents_count, unique_receipents_count }) {
    checkResult.classList.remove('text-danger', 'text-muted');
    checkResult.classList.add('text-body');

    // null/undefined → 0
    const sent = sent_email_count ?? 0;
    const total = total_receipents_count ?? 0;
    const unique = unique_receipents_count ?? 0;

    checkResult.innerHTML = `
      <div><strong>Authentication:</strong> OK ✅</div>
      <div class="mt-2"><strong>Last 24h (Sent Mail):</strong></div>
      <ul class="mb-0">
        <li>Emails sent: <strong>${sent}</strong></li>
        <li>Total recipients (to+cc+bcc): <strong>${total}</strong></li>
        <li>Unique recipients: <strong>${unique}</strong></li>
      </ul>
    `;
  }

  function renderCheckError(message) {
    checkResult.classList.remove('text-body', 'text-muted');
    checkResult.classList.add('text-danger');
    checkResult.innerHTML = `❌ ${message}`;
  }

  async function extractError(res) {
    // Tries to parse common error formats
    try {
      const data = await res.json();
      if (data?.error) return typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
      if (data?.message) return data.message;
    } catch (_) {
      // ignore JSON parse errors
    }
    try {
      const text = await res.text();
      if (text) return text;
    } catch (_) {}
    return `Request failed with status ${res.status}`;
  }

  async function onCheckClick() {
    const user = getTrim('user');
    const pass = getVal('pass');

    if (!user || !pass) {
      renderCheckError('Please enter Gmail address and app password.');
      return;
    }

    setPending();
    checkBtn.disabled = true;

    try {
      const res = await fetch('/api/receipents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Backend expects { user, apppassword }
        body: JSON.stringify({ user, apppassword: pass })
      });

      if (!res.ok) {
        const msg = await extractError(res);
        renderCheckError(msg);
        return;
      }

      const data = await res.json().catch(() => ({}));
      renderCheckSuccess(data || {});
    } catch (err) {
      renderCheckError(err?.message || String(err));
    } finally {
      checkBtn.disabled = false;
    }
  }

  // Wire up after DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    checkBtn = byId('checkBtn');
    checkResult = byId('checkResult');

    if (!checkBtn || !checkResult) return; // HTML not present
    checkBtn.addEventListener('click', onCheckClick);
  });
})();
