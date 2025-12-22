// main.js - Frontend logic for search and medication confirmation

async function searchPatients() {
  const name = document.getElementById('q-name').value.trim();
  const dob = document.getElementById('q-dob').value.trim();
  const rx = document.getElementById('q-rx').value.trim();

  const params = new URLSearchParams();
  if (name) params.append('name', name);
  if (dob) params.append('dob', dob);
  if (rx) params.append('rx', rx);

  const res = await fetch('/api/patients?' + params.toString());
  const patients = await res.json();
  const results = document.getElementById('results');
  results.innerHTML = '';

  if (patients.length === 0) {
    results.innerHTML = '<p class="muted">검색 결과가 없습니다.</p>';
    return;
  }

  patients.forEach(p => {
    const el = document.createElement('div');
    el.className = 'patient-card';
    el.innerHTML = `
      <div><strong>${p.name}</strong> <span class="muted">(${p.dob})</span></div>
      <div class="actions">
        <button data-id="${p.id}" class="btn-open">처방 보기</button>
      </div>
    `;
    results.appendChild(el);
  });

  // attach handlers
  document.querySelectorAll('.btn-open').forEach(b => {
    b.addEventListener('click', () => loadPrescriptions(b.dataset.id));
  });
}

async function loadPrescriptions(patientId) {
  const res = await fetch(`/api/patients/${patientId}/prescriptions`);
  if (!res.ok) {
    alert('처방 정보를 불러오는 중 오류가 발생했습니다.');
    return;
  }
  const prescriptions = await res.json();
  const container = document.getElementById('prescriptions');
  container.innerHTML = '';

  const pharmacist = document.getElementById('pharmacist');

  prescriptions.forEach(pr => {
    const card = document.createElement('div');
    card.className = 'prescription-card';
    card.innerHTML = `
      <div class="med-info">
        <div class="med-name">${pr.medName}</div>
        <div>${pr.dosage} · ${pr.frequency}</div>
        <div class="muted">예정 복용시간: ${pr.times.join(', ')}</div>
      </div>
      <div class="verify">
        <label>바코드/QR 입력 <input class="barcode-input" placeholder="스캔 또는 바코드 입력"></label>
        <div class="warn" style="display:none;color:#b00">처방된 약과 일치하지 않습니다!</div>
        <button class="btn-administer">투약 완료</button>
      </div>
    `;

    // Attach logic for barcode validation and logging
    const barcodeInput = card.querySelector('.barcode-input');
    const warnEl = card.querySelector('.warn');
    const btn = card.querySelector('.btn-administer');

    btn.addEventListener('click', async () => {
      const scanned = barcodeInput.value.trim();
      // if scanned is empty, warn
      if (!scanned) {
        alert('바코드 또는 QR 코드를 입력해주세요.');
        return;
      }

      // Validate against prescription barcode
      if (scanned !== pr.barcode) {
        warnEl.style.display = 'block';
        return; // prevent logging when mismatch
      }
      warnEl.style.display = 'none';

      // send log to backend
      const payload = {
        patientId: patientId,
        prescriptionId: pr.id,
        pharmacist: pharmacist.value || 'Unknown',
        barcodeScanned: scanned,
        status: 'administered'
      };

      const r = await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        alert('기록 저장 중 오류가 발생했습니다.');
        return;
      }
      const entry = await r.json();

      // Visual feedback
      btn.disabled = true;
      btn.textContent = '완료 ✔';
      barcodeInput.disabled = true;
      const okNote = document.createElement('div');
      okNote.className = 'note';
      okNote.textContent = `저장됨: ${new Date(entry.timestamp).toLocaleString()}`;
      card.querySelector('.verify').appendChild(okNote);
    });

    container.appendChild(card);
  });
}

document.getElementById('btn-search').addEventListener('click', searchPatients);

// optional: allow Enter to search
['q-name','q-dob','q-rx'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', (e)=>{
    if (e.key === 'Enter') searchPatients();
  });
});
