// Mock Express backend for PharmChecker
// Provides patient search, prescription retrieval, and logging endpoints.

const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const DATA_DIR = path.join(__dirname, 'data');
const PATIENTS_FILE = path.join(DATA_DIR, 'patients.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');

// Helper: read JSON file (synchronously for simplicity)
function readJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    return [];
  }
}

// Helper: write JSON file (synchronously)
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// API: search patients by name, dob, or prescription (rx) number
app.get('/api/patients', (req, res) => {
  const { name, dob, rx } = req.query;
  const patients = readJSON(PATIENTS_FILE);

  const filtered = patients.filter((p) => {
    let ok = true;
    if (name) ok = ok && p.name.toLowerCase().includes(name.toLowerCase());
    if (dob) ok = ok && p.dob === dob;
    if (rx) {
      ok = ok && p.prescriptions && p.prescriptions.some(pr => pr.rxNumber === rx || pr.id === rx);
    }
    return ok;
  });

  // Return lightweight patient info (no full prescription details here)
  const result = filtered.map(p => ({ id: p.id, name: p.name, dob: p.dob }));
  res.json(result);
});

// API: get prescriptions for a patient
app.get('/api/patients/:id/prescriptions', (req, res) => {
  const patients = readJSON(PATIENTS_FILE);
  const patient = patients.find(p => p.id === req.params.id);
  if (!patient) return res.status(404).json({ error: '환자를 찾을 수 없습니다.' });
  res.json(patient.prescriptions || []);
});

// API: append a log entry (투약 기록)
app.post('/api/logs', (req, res) => {
  const { patientId, prescriptionId, pharmacist, barcodeScanned, status, note } = req.body;
  const logs = readJSON(LOGS_FILE);
  const entry = {
    id: `log_${Date.now()}`,
    patientId,
    prescriptionId,
    pharmacist: pharmacist || 'Unknown',
    barcodeScanned: barcodeScanned || null,
    status: status || 'administered',
    note: note || null,
    timestamp: new Date().toISOString()
  };
  logs.unshift(entry); // newest first
  writeJSON(LOGS_FILE, logs);
  res.json(entry);
});

// API: get logs with optional filters (patientName, pharmacist, medName, from, to)
app.get('/api/logs', (req, res) => {
  const { patientName, pharmacist, medName, from, to } = req.query;
  const logs = readJSON(LOGS_FILE);
  const patients = readJSON(PATIENTS_FILE);

  // Join logs with patient and prescription info for filtering/display
  const enriched = logs.map(l => {
    const patient = patients.find(p => p.id === l.patientId) || null;
    const prescription = patient && patient.prescriptions ? patient.prescriptions.find(pr => pr.id === l.prescriptionId) : null;
    return Object.assign({}, l, {
      patientName: patient ? patient.name : null,
      medName: prescription ? prescription.medName : null
    });
  });

  const filtered = enriched.filter(e => {
    let ok = true;
    if (patientName) ok = ok && e.patientName && e.patientName.toLowerCase().includes(patientName.toLowerCase());
    if (pharmacist) ok = ok && e.pharmacist && e.pharmacist.toLowerCase().includes(pharmacist.toLowerCase());
    if (medName) ok = ok && e.medName && e.medName.toLowerCase().includes(medName.toLowerCase());
    if (from) ok = ok && new Date(e.timestamp) >= new Date(from);
    if (to) ok = ok && new Date(e.timestamp) <= new Date(to);
    return ok;
  });

  res.json(filtered);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PharmChecker mock server listening on http://localhost:${PORT}`);
});
