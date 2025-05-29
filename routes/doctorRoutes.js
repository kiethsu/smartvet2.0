// doctorRoutes.js

const express = require("express");
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const Reservation = require('../models/reservation');
const Pet = require('../models/pet'); // needed to update pet details
const Joi = require('joi');
const Service = require('../models/service');
const ServiceCategory = require('../models/serviceCategory');
const Inventory = require('../models/inventory');  // NEW: Inventory model
const Consultation = require('../models/consultation');

// ----------------- Multer Setup -----------------
// Updated storage: files will be stored in public/consultation/
const multer = require('multer');
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/consultation/'); // Ensure this folder exists in your project
  },
  filename: function (req, file, cb) {
    const ext = file.originalname.split('.').pop();
    cb(null, file.fieldname + '-' + Date.now() + '.' + ext);
  }
});
const upload = multer({ storage: storage });

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

// Updated schema for adding consultation details
const addConsultationSchema = Joi.object({
  reservationId: Joi.string().required(),
  consultationNotes: Joi.string().optional().allow(""),
  examWeight: Joi.string().optional().allow(""),
  examTemperature: Joi.string().optional().allow(""),
  examOthers: Joi.string().optional().allow(""),
  diagnosis: Joi.string().optional().allow(""),
  notes: Joi.string().optional().allow(""),
  medicationsData: Joi.string().optional().allow(""),
  servicesData: Joi.string().optional().allow("")
}).unknown(true);  // Allow unknown keys

// Schema for adding a follow-up schedule
const addScheduleSchema = Joi.object({
  reservationId: Joi.string().required(),
  scheduleDate: Joi.date().required(),
  scheduleDetails: Joi.string().required()
});

// -------------------------
// Existing Routes (dashboard, patient, history, profile, etc.)
// -------------------------

// Render Doctor Dashboard with Appointments and Follow-Ups
router.get("/d-dashboard", authMiddleware, async (req, res) => {
  try {
    const now = new Date();
    const totalAppointments = await Reservation.countDocuments({ doctor: req.user.userId });
    const doneAppointments = await Reservation.countDocuments({ doctor: req.user.userId, status: 'Done' });
    const upcomingAppointments = await Reservation.find({
      doctor: req.user.userId,
      status: { $ne: 'Done' },
      "schedule.scheduleDate": { $gte: now }
    }).lean();
    const followUps = await Reservation.find({
      doctor: req.user.userId,
      status: 'Done',
      "schedule.scheduleDate": { $gte: now }
    }).lean();
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

// Helper function for appointments data
async function buildAppointmentsOverTimeData(doctorId) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const past7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    past7Days.push(d);
  }
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

// Render Active Patient Consultations Page
router.get("/d-patient", authMiddleware, async (req, res) => {
  try {
    const patients = await Reservation.find({
      doctor: req.user.userId,
      status: { $ne: 'Done' }
    }).lean();
    const serviceCategories = await ServiceCategory.find({}).lean();
    res.render("doctor/d-patient", { patients, serviceCategories });
  } catch (error) {
    console.error("Error fetching assigned patients:", error);
    res.status(500).send("Server error");
  }
});

// Render Doctor History Page
router.get("/d-history", authMiddleware, async (req, res) => {
  try {
    const history = await Reservation.find({
      doctor: req.user.userId,
      status: 'Done'
    }).populate('doctor', 'username').lean();
    res.render("doctor/d-history", { history });
  } catch (error) {
    console.error("Error fetching history:", error);
    res.status(500).send("Server error");
  }
});

// Render Doctor Profile Page
router.get("/d-profile", authMiddleware, (req, res) => {
  res.render("doctor/d-profile", {
    doctor: { userId: req.user.userId, username: req.user.username }
  });
});

// Mark a Reservation as Done and Update Pet Details
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
    if (reservation.petExists && reservation.pets && reservation.pets.length > 0 && reservation.pets[0].petId) {
      const petId = reservation.pets[0].petId;
      const pet = await Pet.findById(petId);
      if (pet) {
        pet.petName = reservation.pets[0].petName || pet.petName;
        await pet.save();
      }
    }
    reservation.status = 'Done';
    await reservation.save();
    reservation = await Reservation.findById(reservationId).populate('doctor', 'username').lean();
    res.json({ success: true, reservation });
  } catch (error) {
    console.error("Error marking reservation as done:", error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get Consultation Details for a Reservation
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

// Updated Add Consultation Details Endpoint
// Using upload.any() with diskStorage to allow file uploads.
// Updated Add Consultation Details Endpoint
// Using upload.any() with diskStorage to allow file uploads.
router.post("/add-consultation", authMiddleware, upload.any(), validateRequest(addConsultationSchema), async (req, res) => {
  try {
    const {
      reservationId,
      consultationNotes,
      examWeight,
      examTemperature,
      examOthers,
      diagnosis,
      notes,
      medicationsData,
      servicesData
    } = req.body;
    
    // Capture confinement status checkboxes (if none checked, default to empty array)
    const confinementStatus = req.body.confinementStatus || [];
    
    const reservation = await Reservation.findById(reservationId);
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found.' });
    }
    if (reservation.doctor.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to add consultation details for this reservation.' });
    }

    // Build a file map for service files.
    let fileMap = {};
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        if (file.fieldname.startsWith("serviceFile_")) {
          // Field name format: "serviceFile_{serviceId}"
          const serviceId = file.fieldname.split("_")[1];
          fileMap[serviceId] = file.path;
        }
      });
      console.log("File map:", fileMap);
    }

    // Parse medicationsData if provided.
    const medications = medicationsData ? JSON.parse(medicationsData) : [];
    // Parse servicesData if provided.
  // Parse servicesData if provided.
   // Parse and enrich servicesData with real category and file path
   let services = servicesData ? JSON.parse(servicesData) : [];
   services = await Promise.all(services.map(async svc => {
     const full = await Service.findById(svc.serviceId)
                               .populate('category', 'name')
                               .lean();
     return {
       category:    full.category?.name    || 'Uncategorized',
       serviceName: full.serviceName       || svc.serviceName,
       details:     svc.details,
       file:        fileMap[svc.serviceId] || null
     };
   }));

    // Create the consultation record.
    const consultation = new Consultation({
      reservation: reservationId,
      consultationNotes,
      physicalExam: {
        weight: examWeight,
        temperature: examTemperature,
        observations: examOthers
      },
      diagnosis,
      notes,
      medications,
      services,
      confinementStatus // New field added here
    });
    await consultation.save();

reservation.medications = consultation.medications.map(med => ({
  productId:      med.productId,
  medicationName: med.name,
  dosage:         med.dosage,
  remarks:        med.remarks,
  quantity:       med.quantity
}));
   // If you want to keep the same enriched services on the Reservation:
   reservation.services = services.map(srv => ({
     category:    srv.category,
     serviceName: srv.serviceName,
     details:     srv.details,
     file:        srv.file
   }));
// optional follow-up scheduling
if (req.body.scheduleDate && req.body.scheduleDetails) {
  reservation.schedule = {
    scheduleDate:   new Date(req.body.scheduleDate),
    scheduleDetails: req.body.scheduleDetails
  };
}
await reservation.save();

    res.json({ success: true, consultation });
  } catch (error) {
    console.error("Error adding consultation details:", error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// Save a Follow-Up Schedule for a Reservation
router.post(
  "/add-schedule",
  authMiddleware,
  validateRequest(addScheduleSchema),
  async (req, res) => {
    try {
      const { reservationId, scheduleDate, scheduleDetails } = req.body;
      const orig = await Reservation.findById(reservationId);
      if (!orig) {
        return res.status(404).json({ success: false, message: "Reservation not found." });
      }

   
      // 2) Create a brand-new Reservation entry for the follow-up
    // after
const followUp = new Reservation({
  owner:        orig.owner,
  ownerName:    orig.ownerName,
  pets:         orig.pets,
  service:      orig.service,
  date:         new Date(scheduleDate),
  time:         orig.time || null,
  status:       'Pending',
  doctor:       orig.doctor,

  // ← tag it as a follow-up:
  schedule: {
    scheduleDate:   new Date(scheduleDate),
    scheduleDetails // your “Checkup”, “Vaccination” etc.
  }
});

      await followUp.save();

      // 3) Return both so the doctor UI can update immediately if you want
      res.json({ success: true, original: orig, followUp });
    } catch (error) {
      console.error("Error saving schedule:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);


// List Services by Category
router.get("/services/listByCategory", authMiddleware, async (req, res) => {
  try {
    const { categoryId } = req.query;
    if (!categoryId) {
      return res.json({ success: false, message: "Category ID is required." });
    }
    const services = await Service.find({ category: categoryId }).lean();
    res.json({ success: true, services });
  } catch (error) {
    console.error("Error fetching services by category:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// List Inventory Categories
router.get("/inventory/categories", authMiddleware, async (req, res) => {
  try {
    const categories = await Inventory.distinct("category");
    res.json({ success: true, categories });
  } catch (error) {
    console.error("Error fetching inventory categories:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// List Inventory Items by Category
router.get("/inventory/listByCategory", authMiddleware, async (req, res) => {
  try {
    const { category } = req.query;
    if (!category) {
      return res.json({ success: false, message: "Category is required." });
    }
    const products = await Inventory.find({ category: category }).lean();
    res.json({ success: true, products });
  } catch (error) {
    console.error("Error fetching inventory items by category:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// NEW: Endpoint to Check Inventory Quantity for a Product
router.get("/inventory/checkQuantity", authMiddleware, async (req, res) => {
  try {
    const { product } = req.query;
    if (!product) {
      return res.status(400).json({ success: false, message: "Product is required." });
    }
    // Find the inventory item by product name
    const inventoryItem = await Inventory.findOne({ name: product }).lean();
    if (!inventoryItem) {
      return res.status(404).json({ success: false, message: "Product not found in inventory." });
    }
    res.json({ success: true, availableQty: inventoryItem.quantity });
  } catch (error) {
    console.error("Error checking inventory quantity:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
