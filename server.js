const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'database.json');

// Helper functions for database reading/writing
function readData() {
    try {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        return { visitors: 0, donors: [], bookings: [], hospitals: [] };
    }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Middleware to track visitor traffic
app.use((req, res, next) => {
    if (req.path === '/' || req.path === '/index.html') {
        const data = readData();
        data.visitors = (data.visitors || 0) + 1;
        saveData(data);
    }
    next();
});

// --- API ENDPOINTS ---

// 1. DONOR REGISTRATION & HEALTH CHECK
app.post('/api/donors/register', (req, res) => {
    const { name, bloodGroup, age, weight, diseaseHistory, phone, location } = req.body;
    
    // Health Verification Engine
    const numAge = parseInt(age);
    const numWeight = parseFloat(weight);
    let isHealthy = true;
    let qualityScore = 'A+ Grade (Excellent)';
    let rejectionReason = null;

    if (numAge < 18 || numAge > 65) {
        isHealthy = false;
        rejectionReason = 'Age must be between 18 and 65 years.';
    } else if (numWeight < 50) {
        isHealthy = false;
        rejectionReason = 'Weight must be at least 50 kg.';
    } else if (diseaseHistory && diseaseHistory.toLowerCase() !== 'none' && diseaseHistory.toLowerCase() !== 'no') {
        isHealthy = false;
        rejectionReason = 'Disqualified due to reported medical/disease history.';
    }

    if (!isHealthy) qualityScore = 'Unfit for Donation';

    const newDonor = {
        id: 'DON-' + Date.now(),
        name,
        bloodGroup,
        age: numAge,
        weight: numWeight,
        diseaseHistory,
        phone,
        location,
        isHealthy,
        qualityScore,
        rejectionReason,
        registeredAt: new Date().toLocaleString()
    };

    const data = readData();
    data.donors.push(newDonor);
    saveData(data);

    res.json({ success: true, donor: newDonor });
});

// 2. SEARCH HOSPITALS & BLOOD AVAILABILITY
app.get('/api/hospitals/search', (req, res) => {
    const { bloodGroup, type } = req.query; // type: pre-booking, booking, emergency
    const data = readData();

    let results = data.hospitals.filter(h => h.bloodStock && h.bloodStock[bloodGroup] > 0);

    // If Emergency, add priority flags and sort by available units descending
    if (type === 'emergency') {
        results = results.map(h => ({
            ...h,
            emergencyDispatch: true,
            dispatchEta: '15-30 mins'
        })).sort((a, b) => b.bloodStock[bloodGroup] - a.bloodStock[bloodGroup]);
    }

    res.json({ success: true, count: results.length, type, hospitals: results });
});

// 3. BOOK BLOOD REQUEST
app.post('/api/bookings/create', (req, res) => {
    const { patientName, phone, bloodGroup, hospitalId, bookingType } = req.body;
    const data = readData();

    const hospital = data.hospitals.find(h => h.id === parseInt(hospitalId));
    if (!hospital || !hospital.bloodStock[bloodGroup] || hospital.bloodStock[bloodGroup] <= 0) {
        return res.status(400).json({ success: false, message: 'Blood stock unavailable' });
    }

    // Deduct stock
    hospital.bloodStock[bloodGroup] -= 1;

    const newBooking = {
        id: 'BKG-' + Date.now(),
        patientName,
        phone,
        bloodGroup,
        hospitalName: hospital.name,
        hospitalAddress: hospital.address,
        bookingType, // pre-booking, booking, emergency
        status: 'Confirmed',
        createdAt: new Date().toLocaleString()
    };

    data.bookings.push(newBooking);
    saveData(data);

    res.json({ success: true, booking: newBooking });
});

// 4. ADMIN METRICS DASHBOARD
app.get('/api/admin/metrics', (req, res) => {
    const data = readData();
    const totalDonors = data.donors.length;
    const healthyDonors = data.donors.filter(d => d.isHealthy).length;
    
    // Calculate Blood Quality Accuracy Rate
    const accuracy = totalDonors > 0 ? ((healthyDonors / totalDonors) * 100).toFixed(1) : 100;

    res.json({
        totalVisitors: data.visitors || 0,
        totalDonors,
        healthyDonors,
        rejectedDonors: totalDonors - healthyDonors,
        totalBookings: data.bookings.length,
        qualityAccuracyRate: accuracy + '%'
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Blood Bank Server running at http://localhost:${PORT}`);
});