// admin.js - fetch and display logs with filters

async function loadLogs() {
  const patient = document.getElementById('f-patient').value.trim();
  const pharmacist = document.getElementById('f-pharmacist').value.trim();
  const med = document.getElementById('f-med').value.trim();
  const from = document.getElementById('f-from').value.trim();
  const to = document.getElementById('f-to').value.trim();

  const params = new URLSearchParams();
  if (patient) params.append('patientName', patient);
  if (pharmacist) params.append('pharmacist', pharmacist);
  if (med) params.append('medName', med);
  if (from) params.append('from', from);
  if (to) params.append('to', to);

  const res = await fetch('/api/logs?' + params.toString());
  const logs = await res.json();

  const container = document.getElementById('logs');
  container.innerHTML = '';
  if (logs.length === 0) {
    container.innerHTML = '<p class="muted">조회된 로그가 없습니다.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'logs-table';
  table.innerHTML = `
    <thead><tr><th>시간</th><th>환자</th><th>약품</th><th>약사</th><th>바코드</th><th>상태</th></tr></thead>
  `;
  const tbody = document.createElement('tbody');

  logs.forEach(l => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(l.timestamp).toLocaleString()}</td>
      <td>${l.patientName || l.patientId}</td>
      <td>${l.medName || '-'}</td>
      <td>${l.pharmacist}</td>
      <td>${l.barcodeScanned || '-'}</td>
      <td>${l.status}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

document.getElementById('btn-filter').addEventListener('click', loadLogs);
// load initial
loadLogs();
