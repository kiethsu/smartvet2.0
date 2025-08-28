const express = require('express');
const router = express.Router();
const Reservation = require('../models/reservation');
const Pet = require('../models/pet');
const authMiddleware = require('../middleware/authMiddleware');
const AppointmentSetting = require('../models/appointmentSetting');
const User = require('../models/user');
const Joi = require('joi');
const Consultation = require('../models/consultation');
const PetList = require('../models/petlist');
const Inventory    = require('../models/inventory');
const Service      = require('../models/service');
const nodemailer = require('nodemailer'); // Import Nodemailer
const Payment = require('../models/Payment')
const mongoose = require('mongoose');;


// at the top
const PetDetailsSetting = require('../models/petDetailsSetting');
// Helper middleware for validation
function validateRequest(schema, property = 'body') {
  return (req, res, next) => {
    const { error } = schema.validate(req[property]);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }
    next();
  };
}

// Schema for approving reservation (requires reservationId)
const reservationIdSchema = Joi.object({
  reservationId: Joi.string().required()
});
// before any routes
const walkinSchema = Joi.object({
  ownerId: Joi.string().optional().allow(''),
  ownerName: Joi.string().optional().allow(''),
  petName: Joi.string().required().label('Pet Name'),
  species: Joi.string().required().label('Species'),
  breed: Joi.string().required().label('Breed'),
  sex: Joi.string().valid('Male','Female').required().label('Sex'),
  existingDisease: Joi.string().required().label('Existing Disease'),
  otherDisease: Joi.when('existingDisease', {
    is: 'Other',
    then: Joi.string().required().label('Other Disease'),
    otherwise: Joi.forbidden()
  }),
  service: Joi.string().required().label('Service'),
  date: Joi.date().required().label('Date'),
  time: Joi.string().required().label('Time'),
  weight: Joi.number().optional().allow('', null),
  temperature: Joi.number().optional().allow('', null),
  observations: Joi.string().optional().allow(''),
  concerns: Joi.string().optional().allow('')
});

function validateWalkin(req, res, next) {
  const { error, value } = walkinSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      details: error.details.map(d => d.message)
    });
  }
  req.walkinData = value;
  next();
}

// GET /reservation route
router.get('/reservation', authMiddleware, async (req, res) => {
  try {
    // 1) Fetch all reservations
    const reservations = await Reservation.find()
      .populate('doctor', 'username')
      .populate('owner', '_id username')
      .lean();
// 2) Annotate each reservation (multi-pet aware)
for (let r of reservations) {
  const petNames = (r.pets || [])
    .map(p => p.petId?.petName || p.petName)
    .filter(Boolean);

  if (petNames.length === 0) {
    r.petExists = false;
    r.isStacked = false;
    r.isInitialEntry = false;
    continue;
  }

  const entries = await PetList.find(
    { owner: r.owner, petName: { $in: petNames } },
    'petName reservation consultationHistory'
  ).lean();

  const byName = new Map(entries.map(e => [e.petName, e]));

  let allExist = true;
  let allStacked = true;
  let anyInitial = false;

  for (const name of petNames) {
    const entry = byName.get(name);
    if (!entry) { allExist = false; allStacked = false; continue; }

    const hasThisReservation = (entry.consultationHistory || [])
      .some(ch => String(ch.reservation) === String(r._id));
    if (!hasThisReservation) allStacked = false;

    if (String(entry.reservation) === String(r._id)) anyInitial = true;
  }

  r.petExists = allExist;        // all pets have a PetList entry
  r.isStacked = allStacked;      // all those entries include this reservation
  r.isInitialEntry = anyInitial; // at least one entry was created by this reservation
}

    // 3) Compute ongoingReservations
    const ongoingReservations = reservations.filter(r =>
      (r.status === 'Paid' || r.status === 'Done' || !!r.doctor) &&
      !r.isInitialEntry &&
      !r.isStacked
    );

    // 4) Fetch helpers
    const doctors = await User.find({ role: 'Doctor' }).lean();
    const petDetails = (await PetDetailsSetting.findOne().lean()) || {
      species: [], speciesBreeds: {}, diseases: [], services: []
    };
    const pets = await Pet.find().populate('owner', 'username').lean();

    // —— NEW: fetch every PetList entry so we can build the owner→pet dropdown —— 
    const petlistEntries = await PetList.find()
      .populate('owner', 'username')
      .lean();

    // 5) Render, including petlistEntries
    res.render('hr/Reservation', {
      reservations,
      ongoingReservations,
      doctors,
      petDetails,
      pets,
      petlistEntries      // ← now available in your EJS
    });
  } catch (error) {
    console.error("Error fetching reservations:", error);
    res.status(500).send("Server error");
  }
});


// Updated /petlist route
// NEW: load from your PetList model
router.get('/petlist', authMiddleware, async (req, res) => {
  try {
    const entries = await PetList.find()
      .populate('owner', 'username')
      .populate({
        path: 'consultationHistory.consultation',
        select: 'createdAt',    // or any fields you want
      })
      .lean();
    res.render('hr/petlist', { entries });
  } catch (err) {
    console.error("Error fetching pet list:", err);
    res.status(500).send("Server error");
  }
});
// ── after your other GET endpoints (e.g. /reservation, /petlist, /get-medication, etc.) ──
// hrroutes.js

// at top


// …

router.get('/get-owner-pets', authMiddleware, async (req, res) => {
  const { ownerId } = req.query;
  if (!ownerId) return res.json({ pets: [] });

  // 1) pull PetList walk-in names
  const listEntries = await PetList
    .find({ owner: ownerId })
    .lean();
  const listNames = listEntries.map(e => e.petName);

  // 2) pull your “real” Pet documents
  const realPets = await Pet
    .find({ owner: ownerId })
    .lean();
  const realNames = realPets.map(p => p.petName);

  // 3) merge + dedupe
  const allNames = Array.from(new Set([...realNames, ...listNames]));

  res.json({ pets: allNames });
});

// then your route
router.post(
  '/walkin-reservation',
  authMiddleware,
  validateWalkin,
  async (req, res) => {
    try {
      // now you know req.walkinData has everything
      const {
        ownerId,
        ownerName,
        petName,
        species,
        breed,
        sex,
        existingDisease,
        otherDisease,
        service,
        date,
        time,
        weight,
        temperature,
        observations,
        concerns
      } = req.walkinData;

      console.log('📝 walkin-reservation payload:', req.walkinData);

      // 1) Determine or create owner
      let userId, nameToSave;
      if (ownerId) {
        const existing = await User.findById(ownerId);
        if (!existing) {
          return res.status(400).json({ success: false, message: 'Invalid owner.' });
        }
        userId     = ownerId;
        nameToSave = existing.username;
      } else {
        // new owner
        nameToSave = ownerName.trim();
        const newUser = await User.create({ username: nameToSave, role: 'Guest' });
        userId = newUser._id;
      }

      // 2) normalize disease
      const disease = existingDisease === 'Other'
                    ? otherDisease.trim()
                    : existingDisease;

      // 3) create the reservation
      const reservation = await Reservation.create({
        owner:     userId,
        ownerName: nameToSave,
        pets:      [{ petName }],
        service, date, time, weight, temperature,
        observations, concerns,
        status:    'Approved'
      });

      // 4) only add pet record if they don’t already have one
      const alreadyHas = await Pet.exists({ owner: userId, petName });
      if (!alreadyHas) {
        await Pet.create({
          owner:               userId,
          petName,
          species,
          breed,
          birthday:            null,
          existingDisease:     disease,
          sex,
          petPic:              '',
          addedFromReservation:true
        });
      }

      // 5) return success
      res.json({ success: true, reservation });
    } catch (err) {
      console.error('Walkin reservation error:', err);
      res.status(500).json({ success: false, message: 'Server error.' });
    }
  }
);

// Approve Reservation route (updated with email notification)
// Approve Reservation route (updated with email notification using verified sender)
router.post('/approve-reservation', authMiddleware, validateRequest(reservationIdSchema), async (req, res) => {
  try {
    const { reservationId } = req.body;
    const reservation = await Reservation.findById(reservationId);
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found.' });
    }
    
    // Set status to Approved and save
    reservation.status = 'Approved';
    await reservation.save();

    // Fetch customer details (assuming reservation.owner is the customer's ID)
    const customer = await User.findById(reservation.owner);
    if (customer && customer.email) {
      // Configure the nodemailer transporter using Brevo SMTP settings
      const transporter = nodemailer.createTransport({
        host: "smtp-relay.brevo.com",
        port: 587,
        secure: false,
        auth: {
          user: process.env.SMTP_EMAIL,
          pass: process.env.SMTP_PASS
        },
        logger: true,
        debug: true
      });

      // Optional: Verify the SMTP connection
      transporter.verify((error, success) => {
        if (error) {
          console.error("SMTP connection error:", error);
        } else {
          console.log("Server is ready to send emails.");
        }
      });

      // Compose the notification email using the verified sender
      const mailOptions = {
        from: `"SmartVet Clinic" <dehe.marquez.au@phinmaed.com>`,
        to: customer.email,
        subject: "Your Consultation is Approved!",
        text: `Hello ${customer.username},

Your consultation has been approved by our HR team.
You can now visit the vet clinic at your earliest convenience.

Thank you,
SmartVet Clinic`
      };

      // Send the email (errors here are logged but do not block the approval)
      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error("Error sending approval email:", error);
        } else {
          console.log("Approval email sent:", info.response);
        }
      });
    } else {
      console.error("Customer email not found.");
    }

    res.json({ success: true, reservation });
  } catch (error) {
    console.error("Error approving reservation:", error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// Schema for assigning a doctor
const assignDoctorSchema = Joi.object({
  reservationId: Joi.string().required(),
  doctorId: Joi.string().required()
});

router.post('/assign-doctor', authMiddleware, validateRequest(assignDoctorSchema), async (req, res) => {
  try {
    const { reservationId, doctorId } = req.body;
    const reservation = await Reservation.findById(reservationId);
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found.' });
    }
    if (reservation.doctor && reservation.doctor.toString() === doctorId) {
      return res.status(400).json({ success: false, message: 'Doctor is already assigned to this reservation.' });
    }
    reservation.doctor = doctorId;
    await reservation.save();
    await reservation.populate('doctor', 'username');
    res.json({ success: true, reservation });
  } catch (error) {
    console.error("Error assigning doctor:", error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET limit-per-hour route (no validation required)
router.get('/limit-per-hour', authMiddleware, async (req, res) => {
  try {
    let setting = await AppointmentSetting.findOne().lean();
    if (!setting) {
      setting = await AppointmentSetting.create({});
      setting = setting.toObject();
    }
    res.render('hr/limitPerHour', { setting });
  } catch (error) {
    console.error("Error fetching appointment setting:", error);
    res.status(500).send("Server error");
  }
});

// Schema for updating limit-per-hour
const limitPerHourSchema = Joi.object({
  limitPerHour: Joi.number().integer().min(1).required()
});

router.post('/limit-per-hour', authMiddleware, validateRequest(limitPerHourSchema), async (req, res) => {
  try {
    const { limitPerHour } = req.body;
    let setting = await AppointmentSetting.findOne();
    if (!setting) {
      setting = await AppointmentSetting.create({ limitPerHour });
    } else {
      setting.limitPerHour = limitPerHour;
      await setting.save();
    }
    res.json({ success: true, setting });
  } catch (error) {
    console.error("Error updating appointment setting:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET medication details for a reservation (validate reservationId in query)
router.get('/get-medication', authMiddleware, validateRequest(reservationIdSchema, 'query'), async (req, res) => {
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
    console.error("Error fetching medication details:", error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Add pet from reservation (validate reservationId)
// 1) Add to PetList (on “Add” button)
// Add to PetList (on “Add” button)
router.post('/add-to-petlist', authMiddleware, validateRequest(reservationIdSchema), async (req, res) => {
  try {
    const { reservationId } = req.body;

    const reservation = await Reservation.findById(reservationId).lean();
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found.' });

    const consults = await Consultation.find({ reservation: reservationId }).lean();
    if (!consults.length) return res.status(404).json({ success: false, message: 'No consult found.' });

    // helper to resolve pet name for a consultation
    const petsArr = reservation.pets || [];
    const resolvePetName = (c) => {
      if (c?.targetPetName && String(c.targetPetName).trim()) return String(c.targetPetName).trim();
      if (c?.petName && String(c.petName).trim())             return String(c.petName).trim();

      const byId = c?.targetPetId || c?.petId;
      if (byId && mongoose.isValidObjectId(byId)) {
        const hit = petsArr.find(p => String(p.petId?._id) === String(byId));
        if (hit) return hit.petId?.petName || hit.petName || '—';
      }

      const byNameMaybe = (typeof byId === 'string' && !mongoose.isValidObjectId(byId)) ? byId : null;
      if (byNameMaybe) {
        const hit = petsArr.find(p => (p.petId?.petName || p.petName) === byNameMaybe);
        if (hit) return hit.petId?.petName || hit.petName || '—';
      }

      if (petsArr.length === 1) return petsArr[0].petId?.petName || petsArr[0].petName || '—';
      return '—';
    };

    for (const c of consults) {
      const petName = resolvePetName(c);
      if (!petName || petName === '—') continue;

      let entry = await PetList.findOne({ owner: reservation.owner, petName }).lean();

      if (!entry) {
        // create new entry for this pet
        entry = await PetList.create({
          owner: reservation.owner,
          petName,
          reservation: reservationId,
          consultationHistory: [{ reservation: reservationId, consultation: c._id }]
        });
      } else {
        // push only if this reservation not present yet
        const hasThis = (entry.consultationHistory || [])
          .some(ch => String(ch.reservation) === String(reservationId));
        if (!hasThis) {
          await PetList.updateOne(
            { _id: entry._id },
            { $push: { consultationHistory: { reservation: reservationId, consultation: c._id } } }
          );
        }
      }
    }

    await Reservation.findByIdAndUpdate(reservationId, { status: 'Done' });
    return res.json({ success: true });
  } catch (err) {
    console.error('Error in add-to-petlist:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});



// 2) Update PetList (on “Update” button)
// 2) Update PetList (on “Update” button)
router.post('/update-petlist', authMiddleware, validateRequest(reservationIdSchema), async (req, res) => {
  try {
    const { reservationId } = req.body;

    const reservation = await Reservation.findById(reservationId).lean();
    if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found.' });

    const consults = await Consultation.find({ reservation: reservationId }).lean();
    if (!consults.length) return res.status(404).json({ success: false, message: 'No consult found.' });

    const petsArr = reservation.pets || [];
    const resolvePetName = (c) => {
      if (c?.targetPetName && String(c.targetPetName).trim()) return String(c.targetPetName).trim();
      if (c?.petName && String(c.petName).trim())             return String(c.petName).trim();
      const byId = c?.targetPetId || c?.petId;
      if (byId && mongoose.isValidObjectId(byId)) {
        const hit = petsArr.find(p => String(p.petId?._id) === String(byId));
        if (hit) return hit.petId?.petName || hit.petName || '—';
      }
      const byNameMaybe = (typeof byId === 'string' && !mongoose.isValidObjectId(byId)) ? byId : null;
      if (byNameMaybe) {
        const hit = petsArr.find(p => (p.petId?.petName || p.petName) === byNameMaybe);
        if (hit) return hit.petId?.petName || hit.petName || '—';
      }
      if (petsArr.length === 1) return petsArr[0].petId?.petName || petsArr[0].petName || '—';
      return '—';
    };

    for (const c of consults) {
      const petName = resolvePetName(c);
      if (!petName || petName === '—') continue;

      let entry = await PetList.findOne({ owner: reservation.owner, petName }).lean();

      if (!entry) {
        // if somehow missing, create it (makes Update safe if Add was skipped)
        entry = await PetList.create({
          owner: reservation.owner,
          petName,
          reservation: reservationId,
          consultationHistory: [{ reservation: reservationId, consultation: c._id }]
        });
      } else {
        const hasThis = (entry.consultationHistory || [])
          .some(ch => String(ch.reservation) === String(reservationId));
        if (!hasThis) {
          await PetList.updateOne(
            { _id: entry._id },
            { $push: { consultationHistory: { reservation: reservationId, consultation: c._id } } }
          );
        }
      }
    }

    await Reservation.findByIdAndUpdate(reservationId, { status: 'Done' });
    return res.json({ success: true });
  } catch (err) {
    console.error('Error in update-petlist:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});




// GET /hr/get-pet-history
router.get(
  '/get-pet-history',
  authMiddleware,
  async (req, res) => {
    const { petId, petName, ownerId } = req.query;
    if (!petId && !petName) {
      return res.json({ success: false, message: 'petId or petName is required' });
    }

    // 1) populate consultation → reservation → doctor & schedule
    const entry = await PetList.findOne(
      petId
        ? { _id: petId }
        : { owner: ownerId, petName }
    )
    .populate({
      path: 'consultationHistory.consultation',
      populate: [
        {
          path: 'reservation',
          select: 'date doctor schedule',
          populate: { path: 'doctor', select: 'username' }
        }
      ]
    })
    .lean();

    if (!entry) {
      return res.json({ success: false, message: 'PetList entry not found.' });
    }

    // 2) map out history with nextSchedule
    const history = entry.consultationHistory
      .map(ch => {
        const c   = ch.consultation || {};
        const resv = c.reservation || {};
        return {
          id:         c._id,
          date:       c.createdAt || ch.addedAt,
          doctor:     resv.doctor || null,
          notes:      c.notes || c.consultationNotes || '',
          physical:   c.physicalExam || { weight: '', temperature: '', observations: '' },
          diagnosis:  c.diagnosis || '',
          services:   (c.services || []).map(s => ({
                        category:    s.category    || 'Uncategorized',
                        serviceName: s.serviceName || '',
                        details:     s.details     || '',
                        file:        s.file        || null
                      })),
          medications:(c.medications || []).map(m => ({
                        name:     m.name     || m.medicationName || '',
                        dosage:   m.dosage   || '',
                        remarks:  m.remarks  || '',
                        quantity: m.quantity || 0
                      })),
          confinement:c.confinementStatus || [],
          nextSchedule: resv.schedule
            ? {
                date:    resv.schedule.scheduleDate,
                details: resv.schedule.scheduleDetails
              }
            : null
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    return res.json({ success: true, history });
  }
);

// at the bottom of hrroutes.js
router.post('/add-consult-existing', authMiddleware, async (req, res) => {
  // pull req.body.ownerName, petId, service, date, time, weight, temperature, observations, concerns
  // create a new Reservation (or Consultation) record
  // return { success: true }
});
// GET /hr/get-consultation-details
// GET /hr/get-consultation-details  (PASTE/REPLACE)
router.get('/get-consultation-details', authMiddleware, async (req, res) => {
  try {
    const { reservationId } = req.query;
    if (!reservationId) {
      return res.json({ success: false, message: 'Missing reservationId' });
    }

    const reservation = await Reservation.findById(reservationId)
      .populate('owner', 'username')
      .populate('pets.petId', 'petName')
      .lean();
    if (!reservation) {
      return res.json({ success: false, message: 'Reservation not found' });
    }

    // Pull all per-pet consultations for this reservation
// load newest first
const consultDocs = await Consultation
  .find({ reservation: reservationId })
  .sort({ updatedAt: -1, _id: -1 })
  .lean();

// keep ONLY the latest consultation per pet (prefer id; fallback to name)
const latestByPet = new Map();
for (const c of consultDocs) {
  const key = c.targetPetId
    ? `id:${c.targetPetId}`
    : `name:${(c.targetPetName || c.petName || '').trim().toLowerCase()}`;
  if (!latestByPet.has(key)) latestByPet.set(key, c); // first = newest due to sort
}

    // Helper: resolve pet name for a consultation (supports either petId or petName)
   // at top of file we already have: const mongoose = require('mongoose');
// Helper: resolve pet name for a consultation (supports targetPet* and legacy pet*)
function resolvePetName(c) {
  // 1) explicit names first
  if (c?.targetPetName && String(c.targetPetName).trim()) return String(c.targetPetName).trim();
  if (c?.petName && String(c.petName).trim())             return String(c.petName).trim();

  const petsArr = reservation.pets || [];

  // 2) try by id (prefer targetPetId; fall back to petId)
  const candidateId = c?.targetPetId || c?.petId;
  if (candidateId && mongoose.isValidObjectId(candidateId)) {
    const hitById = petsArr.find(p => String(p.petId?._id) === String(candidateId));
    if (hitById) return hitById.petId?.petName || hitById.petName || '—';
  }

  // 3) try by name string (some old data put the name in petId)
  const candidateName =
    (typeof candidateId === 'string' && !mongoose.isValidObjectId(candidateId))
      ? candidateId
      : (c?.targetPetName || c?.petName || null);

  if (candidateName) {
    const hitByName = petsArr.find(p => (p.petId?.petName || p.petName) === candidateName);
    if (hitByName) return hitByName.petId?.petName || hitByName.petName || '—';
  }

  // 4) single-pet reservation fallback
  if (petsArr.length === 1) return petsArr[0].petId?.petName || petsArr[0].petName || '—';

  return '—';
}



    // Enrich medications/services with prices (from Inventory/Service)
    const consultations = [];
for (const c of latestByPet.values()) {
  const petName = resolvePetName(c);

  // ----- Medications -----
  const meds = [];
  for (const m of (c.medications || [])) {
    const medName = m.name || m.medicationName || '';
    let inv = null;
    if (medName) inv = await Inventory.findOne({ name: medName }).lean();
const unitPrice =
  (typeof m.unitPrice === 'number')
    ? m.unitPrice
    : (typeof inv?.basePrice === 'number'
        ? inv.basePrice
        : (typeof inv?.price === 'number' ? inv.price : 0));

    const hasConsultTarget = !!(c.targetPetId || c.targetPetName || c.petId || c.petName);
    const medHasTarget     = !!(m.targetPetId || m.petId || m.targetPetName || m.petName);
    const inferredAdded    = m.added === true ? true : (!hasConsultTarget && !medHasTarget);

    meds.push({
      ...m,
      name: medName,
      unitPrice,
      category: m.category || inv?.category || 'Uncategorized',
      quantity: Number(m.quantity || 0),
      added: !!inferredAdded
    });
  }

  // ----- Services -----
  const svcs = [];
  for (const s of (c.services || [])) {
    let svcDoc = null;
    if (s.serviceId) {
      try { svcDoc = await Service.findById(s.serviceId).lean(); } catch {}
    }
    if (!svcDoc && s.serviceName) {
      svcDoc = await Service.findOne({ serviceName: s.serviceName }).lean();
    }
    svcs.push({
      ...s,
      serviceName: s.serviceName || svcDoc?.serviceName || '',
      price: (typeof s.price === 'number') ? s.price : (svcDoc?.price || 0)
    });
  }

  consultations.push({
    petId: c.petId || null,
    petName,
    medications: meds,
    services: svcs
  });
}

    // Payment present?
    const payment = await Payment.findOne({ reservation: reservationId }).lean();

    res.json({
      success: true,
      data: { reservation, consultations, payment: payment || null }
    });
  } catch (err) {
    console.error('get-consultation-details failed:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// Put this near your other Joi schemas in hrroutes.js

// Accept extra keys on each line item (e.g., pet, category, etc.)
const lineItemSchema = Joi.object({
  name:      Joi.string().required(),
  quantity:  Joi.number().min(0).required(),
  unitPrice: Joi.number().min(0).required(),
  lineTotal: Joi.number().min(0).required()
}).unknown(true);

const markPaidSchema = Joi.object({
  reservationId: Joi.string().required(),
  amount:        Joi.number().min(0).required(),
  products:      Joi.array().items(lineItemSchema).default([]),
  services:      Joi.array().items(lineItemSchema).default([])
});

router.get('/get-consultation', authMiddleware, async (req, res) => {
  try {
    const { reservationId } = req.query;
    if (!reservationId) {
      return res.status(400).json({ success: false, message: 'reservationId is required.' });
    }

    const reservation = await Reservation.findById(reservationId)
      .populate('doctor', 'username')
      .populate('pets.petId', 'petName birthday species breed sex') // so we can show more pet info
      .lean();

    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found.' });
    }

    // merge its Consultation (if any)
    const consult = await Consultation.findOne({ reservation: reservationId }).lean();
    if (consult) {
      reservation.physicalExam       = consult.physicalExam;
      reservation.diagnosis          = consult.diagnosis;
      reservation.services           = consult.services;
      reservation.medications        = consult.medications;
      reservation.notes              = consult.notes;
      reservation.confinementStatus  = consult.confinementStatus;
    }

    return res.json({ success: true, reservation });
  } catch (err) {
    console.error('HR get-consultation error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// HR: Check inventory quantity for medications (so your HR UI can call it)
router.get('/inventory/checkQuantity', authMiddleware, async (req, res) => {
  try {
    const { product } = req.query;
    if (!product) {
      return res.status(400).json({ success: false, message: 'Product is required.' });
    }
    const inventoryItem = await Inventory.findOne({ name: product }).lean();
    if (!inventoryItem) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }
    res.json({ success: true, availableQty: inventoryItem.quantity });
  } catch (error) {
    console.error("Error checking inventory quantity (HR):", error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
// GET /hr/inventory/categories
router.get('/inventory/categories', authMiddleware, async (req, res) => {
  try {
    const cats = await Inventory.distinct('category');
    res.json({ success: true, categories: cats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /hr/inventory/listByCategory?category=…
router.get('/inventory/listByCategory', authMiddleware, async (req, res) => {
  try {
    const { category } = req.query;
  const products = await Inventory.find({ category }, 'name basePrice').lean();
res.json({
  success: true,
  products: products.map(p => ({ name: p.name, price: p.basePrice }))
});

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Your /mark-paid route
router.post(
  '/mark-paid',
  authMiddleware,
  validateRequest(markPaidSchema),
  async (req, res) => {
    try {
      const { reservationId, amount, products, services } = req.body;
// keep only the fields we actually store
const cleanProducts = (products || []).map(p => ({
  name:      p.name,
  quantity:  Number(p.quantity)  || 0,
  unitPrice: Number(p.unitPrice) || 0,
  lineTotal: Number(p.lineTotal) || 0
}));

const cleanServices = (services || []).map(s => ({
  name:      s.name,
  quantity:  Number(s.quantity)  || 0,
  unitPrice: Number(s.unitPrice) || 0,
  lineTotal: Number(s.lineTotal) || 0
}));

      // 1) Find & mark reservation paid
      const reservation = await Reservation.findById(reservationId);
      if (!reservation) {
        return res.status(404).json({ success: false, message: 'Reservation not found.' });
      }
      reservation.status = 'Paid';
      await reservation.save();

// 2) Decrement each product’s inventory (skip full-doc validation)
for (const { name, quantity } of cleanProducts) {
  const invDoc = await Inventory.findOne({ name }).lean();
  if (!invDoc) continue;

  const newQty = Math.max((invDoc.quantity || 0) - Number(quantity || 0), 0);

  // Only update the quantity field; this won't trigger required validators on other fields
  await Inventory.updateOne(
    { _id: invDoc._id },
    { $set: { quantity: newQty } }
  );
}

      // 3) Save the payment record — now with customer & by
   const payment = new Payment({
  reservation: reservation._id,
  customer:    reservation.owner,
  by:          req.user.userId,
  products:    cleanProducts,
  services:    cleanServices,
  amount
});
await payment.save();

      return res.json({ success: true, reservation });
    } catch (err) {
      console.error('Error marking paid and updating inventory:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);


// 1) Update one medication’s quantity
router.post(
  '/update-medication',
  authMiddleware,
  validateRequest(Joi.object({
    reservationId: Joi.string().required(),
    medicationName:Joi.string().required(),
    quantity:      Joi.number().min(0).required()
  })),
  async (req, res) => {
    const { reservationId, medicationName, quantity } = req.body;
    try {
      // find the consultation
      const consult = await Consultation.findOne({ reservation: reservationId });
      if (!consult) return res.status(404).json({ success:false, message:'No consultation.' });

      // find the med entry and update its qty
      const med = consult.medications.find(m => m.name === medicationName);
      if (!med) return res.status(404).json({ success:false, message:'Medication not found.' });
      med.quantity = quantity;
      await consult.save();

      res.json({ success:true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success:false, message:'Server error' });
    }
  }
);

// 2) Remove a medication entirely
router.post(
  '/remove-medication',
  authMiddleware,
  validateRequest(Joi.object({
    reservationId: Joi.string().required(),
    medicationName:Joi.string().required()
  })),
  async (req, res) => {
    const { reservationId, medicationName } = req.body;
    try {
      const consult = await Consultation.findOne({ reservation: reservationId });
      if (!consult) return res.status(404).json({ success:false, message:'No consultation.' });

      // filter out the med
      consult.medications = consult.medications.filter(m => m.name !== medicationName);
      await consult.save();

      res.json({ success:true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success:false, message:'Server error' });
    }
  }
);
// Add a new medication to the consultation
const addMedicationSchema = Joi.object({
  reservationId:   Joi.string().required(),
  medicationName:  Joi.string().required(),
  quantity:        Joi.number().min(1).required()
});

// Add a new medication to the consultation
router.post('/add-medication', authMiddleware, validateRequest(addMedicationSchema), async (req, res) => {
  try {
    const { reservationId, medicationName, quantity } = req.body;
    const consult = await Consultation.findOne({ reservation: reservationId });
    if (!consult) return res.status(404).json({ success:false, message:'Consultation not found.' });

    // 👇 mark manual additions
    consult.medications.push({ name: medicationName, quantity, added: true });
    await consult.save();
    res.json({ success:true });
  } catch (err) {
    console.error('Error adding medication:', err);
    res.status(500).json({ success:false, message:'Server error.' });
  }
});


module.exports = router;
