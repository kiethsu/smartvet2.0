const express = require("express");
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const Reservation = require('../models/reservation');
const Pet = require('../models/pet'); // needed to update pet details
const Joi = require('joi');

// Validation middleware helper
function validateRequest(schema, property = 'body') {
  return (req, res, next) => {
    const { error } = schema.validate(req[property]);
    if (error) {
      console.error("Validation error:", error.details[0].message);
      return res.status(400).json({ message: error.details[0].message });
    }
    next();
  };
}

// Schema for routes that require reservationId (in either body or query)
const reservationIdSchema = Joi.object({
  reservationId: Joi.string().required()
});

// Schema for adding consultation details
const addConsultationSchema = Joi.object({
  reservationId: Joi.string().required(),
  consultationNotes: Joi.string().optional().allow(""),
  medicationsData: Joi.string().optional().allow("")
}).unknown(true);  // Allow unknown keys

// Schema for adding a follow-up schedule
const addScheduleSchema = Joi.object({
  reservationId: Joi.string().required(),
  scheduleDate: Joi.date().required(),
  scheduleDetails: Joi.string().required()
});

// -------------------------
// Render Doctor Dashboard with Appointments and Follow-Ups
// -------------------------
router.get("/d-dashboard", authMiddleware, async (req, res) => {
  try {
    const now = new Date();

    // Total appointments assigned to this doctor
    const totalAppointments = await Reservation.countDocuments({
      doctor: req.user.userId
    });

    // Completed appointments
    const doneAppointments = await Reservation.countDocuments({
      doctor: req.user.userId,
      status: 'Done'
    });

    // Upcoming appointments (not done and with a future schedule date)
    const upcomingAppointments = await Reservation.find({
      doctor: req.user.userId,
      status: { $ne: 'Done' },
      "schedule.scheduleDate": { $gte: now }
    }).lean();

    // Follow-ups (done but with a future schedule)
    const followUps = await Reservation.find({
      doctor: req.user.userId,
      status: 'Done',
      "schedule.scheduleDate": { $gte: now }
    }).lean();

    // Build dynamic appointments over time data (past 7 days)
    const appointmentsOverTime = await buildAppointmentsOverTimeData(req.user.userId);

    res.render("doctor/d-dashboard", {
      doctor: { userId: req.user.userId, username: req.user.username },
      totalAppointments,
      doneAppointments,
      upcomingAppointments,
      followUps,
      appointmentsOverTime
    });
  } catch (error) {
    console.error("Error rendering doctor dashboard:", error);
    res.status(500).send("Server error");
  }
});

// Updated helper function: Build dynamic appointments data for the past 7 days
async function buildAppointmentsOverTimeData(doctorId) {
  // Set today's date to end of day
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  // Create an array for the past 7 days (including today)
  const past7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    past7Days.push(d);
  }

  // For each day, count the number of appointments created by this doctor
  const data = [];
  for (let d of past7Days) {
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    const count = await Reservation.countDocuments({
      doctor: doctorId,
      createdAt: { $gte: start, $lte: end }
    });
    data.push({ label: d.toISOString().slice(0, 10), count });
  }
  return data;
}

// -------------------------
// Render Active Patient Consultations Page
// -------------------------
router.get("/d-patient", authMiddleware, async (req, res) => {
  try {
    const patients = await Reservation.find({
      doctor: req.user.userId,
      status: { $ne: 'Done' }
    }).lean();
    res.render("doctor/d-patient", { patients });
  } catch (error) {
    console.error("Error fetching assigned patients:", error);
    res.status(500).send("Server error");
  }
});

// -------------------------
// Render Doctor History Page
// -------------------------
router.get("/d-history", authMiddleware, async (req, res) => {
  try {
    const history = await Reservation.find({
      doctor: req.user.userId,
      status: 'Done'
    })
      .populate('doctor', 'username')
      .lean();
    res.render("doctor/d-history", { history });
  } catch (error) {
    console.error("Error fetching history:", error);
    res.status(500).send("Server error");
  }
});

// -------------------------
// Render Doctor Profile Page
// -------------------------
router.get("/d-profile", authMiddleware, (req, res) => {
  res.render("doctor/d-profile", {
    doctor: { userId: req.user.userId, username: req.user.username }
  });
});

// -------------------------
// Mark a Reservation as Done and Update Pet Details
// -------------------------
router.post("/mark-as-done", authMiddleware, validateRequest(reservationIdSchema), async (req, res) => {
  try {
    const { reservationId } = req.body;
    let reservation = await Reservation.findById(reservationId);
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found.' });
    }
    if (reservation.doctor.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to mark this reservation as done.' });
    }
    
    // If the reservation is for an existing pet and pet data is linked, update it.
    if (reservation.petExists && reservation.pets && reservation.pets.length > 0 && reservation.pets[0].petId) {
      const petId = reservation.pets[0].petId;
      const pet = await Pet.findById(petId);
      if (pet) {
        pet.petName = reservation.pets[0].petName || pet.petName;
        await pet.save();
      }
    }
    
    // Mark the reservation as done (do not set petAdded so HR can update pet details)
    reservation.status = 'Done';
    await reservation.save();
    
    // Populate doctor's username for response
    reservation = await Reservation.findById(reservationId)
                                     .populate('doctor', 'username')
                                     .lean();
    res.json({ success: true, reservation });
  } catch (error) {
    console.error("Error marking reservation as done:", error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// -------------------------
// Get Consultation Details for a Reservation (validated)
// -------------------------
router.get("/get-consultation", authMiddleware, validateRequest(reservationIdSchema, 'query'), async (req, res) => {
  try {
    const { reservationId } = req.query;
    const reservation = await Reservation.findById(reservationId)
      .populate('pets.petId', 'petName birthday')
      .lean();
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found.' });
    }
    res.json({ success: true, reservation });
  } catch (error) {
    console.error("Error fetching consultation details:", error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// -------------------------
// Add Consultation Details (validated)
// -------------------------
router.post("/add-consultation", authMiddleware, validateRequest(addConsultationSchema), async (req, res) => {
  try {
    const { reservationId, consultationNotes, medicationsData } = req.body;
    const reservation = await Reservation.findById(reservationId);
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found.' });
    }
    if (reservation.doctor.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to add consultation details for this reservation.' });
    }
    reservation.consultationNotes = consultationNotes;
    reservation.medications = medicationsData ? JSON.parse(medicationsData) : [];
    await reservation.save();
    res.json({ success: true, reservation });
  } catch (error) {
    console.error("Error adding consultation details:", error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// -------------------------
// Save a Follow-Up Schedule for a Reservation (validated)
// -------------------------
router.post("/add-schedule", authMiddleware, validateRequest(addScheduleSchema), async (req, res) => {
  try {
    const { reservationId, scheduleDate, scheduleDetails } = req.body;
    const reservation = await Reservation.findById(reservationId);
    if (!reservation) {
      return res.status(404).json({ success: false, message: "Reservation not found." });
    }
    reservation.schedule = {
      scheduleDate: new Date(scheduleDate),
      scheduleDetails
    };
    await reservation.save();
    res.json({ success: true, reservation });
  } catch (error) {
    console.error("Error saving schedule:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// -------------------------
// Optional: API Endpoint to Get Doctor's History
// -------------------------
router.get("/get-history", authMiddleware, async (req, res) => {
  try {
    const history = await Reservation.find({ doctor: req.user.userId, status: 'Done' }).lean();
    res.json({ success: true, history });
  } catch (err) {
    console.error("Error fetching history:", err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
