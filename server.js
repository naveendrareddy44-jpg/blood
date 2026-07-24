const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const DB_FILE = path.join(__dirname, 'database.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper functions to read/write database.json
function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    return { blood_banks: [], inventory: [], emergency_requests: [], request_responses: [] };
  }
  const rawData = fs.readFileSync(DB_FILE, 'utf8');
  return JSON.parse(rawData);
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Distance Helper (Haversine formula for km)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Real-Time Socket Connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register_blood_bank', (bloodBankId) => {
    socket.join(`blood_bank_${bloodBankId}`);
    console.log(`Socket ${socket.id} joined blood bank room ${bloodBankId}`);
  });

  socket.on('track_request', (requestId) => {
    socket.join(`request_${requestId}`);
    console.log(`Socket ${socket.id} joined tracking room ${requestId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// API: Patient Creates Request
app.post('/api/requests', (req, res) => {
  const {
    patient_name,
    patient_phone,
    blood_group,
    component_type,
    units_needed,
    hospital_name,
    latitude = 12.9716,
    longitude = 77.5946
  } = req.body;

  const db = readDB();
  const requestId = 'req_' + Date.now();

  const newRequest = {
    id: requestId,
    patient_name,
    patient_phone,
    blood_group,
    component_type,
    units_needed,
    hospital_name,
    latitude,
    longitude,
    status: 'PENDING',
    created_at: new Date().toISOString()
  };

  db.emergency_requests.push(newRequest);
  writeDB(db);

  // Find matching blood banks and broadcast alerts
  const notifiedBanks = [];
  db.blood_banks.forEach((bb) => {
    const dist = calculateDistance(latitude, longitude, bb.latitude, bb.longitude);
    const stock = db.inventory.find(i => 
      i.blood_bank_id === bb.id && 
      i.blood_group === blood_group && 
      i.component_type === component_type
    );

    const currentStock = stock ? stock.available_units : 0;

    notifiedBanks.push(bb);

    // Dynamic alert broadcast to blood bank WebSocket
    io.to(`blood_bank_${bb.id}`).emit('emergency_alert', {
      requestId,
      patientName: patient_name,
      bloodGroup: blood_group,
      componentType: component_type,
      unitsNeeded: units_needed,
      hospitalName: hospital_name,
      distanceKm: dist.toFixed(2),
      currentStock
    });
  });

  res.status(201).json({
    success: true,
    requestId,
    notifiedBloodBanksCount: notifiedBanks.length
  });
});

// API: Blood Bank Responds & Reserves Stock (No PIN/Auth)
app.post('/api/requests/:requestId/respond', (req, res) => {
  const { requestId } = req.params;
  const { blood_bank_id, units_offered, hold_duration_minutes = 45 } = req.body;

  const db = readDB();
  const holdExpiresAt = new Date(Date.now() + hold_duration_minutes * 60 * 1000).toISOString();

  const responseObj = {
    id: db.request_responses.length + 1,
    request_id: requestId,
    blood_bank_id,
    units_offered,
    hold_expires_at: holdExpiresAt,
    responded_at: new Date().toISOString()
  };

  db.request_responses.push(responseObj);

  // Update request status
  const reqObj = db.emergency_requests.find(r => r.id === requestId);
  if (reqObj) reqObj.status = 'ACCEPTED';

  writeDB(db);

  const bbInfo = db.blood_banks.find(b => b.id === blood_bank_id) || {};

  const updatePayload = {
    responseId: responseObj.id,
    bloodBankId: blood_bank_id,
    bloodBankName: bbInfo.name || 'Blood Bank',
    phone: bbInfo.phone || 'N/A',
    address: bbInfo.address || 'N/A',
    unitsOffered: units_offered,
    holdExpiresAt
  };

  // Notify patient channel
  io.to(`request_${requestId}`).emit('blood_bank_responded', updatePayload);

  res.json({ success: true, response: updatePayload });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`LifeFlow running at http://localhost:${PORT}`));