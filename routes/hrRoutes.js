const express = require('express');
const router = express.Router();
const Reservation = require('../models/reservation');
const Pet = require('../models/pet');
const authMiddleware = require('../middleware/authMiddleware');
const AppointmentSetting = require('../models/appointmentSetting');
const User = require('../models/user');
const Joi = require('joi');
const nodemailer = require('nodemailer'); // Import Nodemailer

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

// GET /reservation route
router.get('/reservation', authMiddleware, async (req, res) => {
  try {
    const reservations = await Reservation.find()
      .populate('doctor', 'username')
      .populate('owner', '_id username')
      .lean();

    for (let reservation of reservations) {
      if (
        reservation.status === 'Done' &&
        reservation.pets &&
        reservation.pets.length > 0 &&
        reservation.owner
      ) {
        const existingPet = await Pet.findOne({
          owner: reservation.owner._id,
          petName: reservation.pets[0].petName,
          addedFromReservation: true
        }).lean();
        reservation.petExists = !!existingPet;
      }
    }

    const doctors = await User.find({ role: 'Doctor' }).lean();
    res.render('hr/reservation', { reservations, doctors });
  } catch (error) {
    console.error("Error fetching reservations:", error);
    res.status(500).send("Server error");
  }
});

// Updated /petlist route
router.get('/petlist', authMiddleware, async (req, res) => {
  try {
    const pets = await Pet.find().populate('owner', 'username').lean();
    res.render('hr/petlist', { pets });
  } catch (error) {
    console.error("Error fetching pet list:", error);
    res.status(500).send("Server error");
  }
});

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
router.post('/add-pet-from-reservation', authMiddleware, validateRequest(reservationIdSchema), async (req, res) => {
  try {
    const { reservationId } = req.body;
    const reservation = await Reservation.findById(reservationId);

    if (!reservation) {
      return res.status(404).json({ success: false, message: "Reservation not found" });
    }
    if (reservation.petAdded) {
      return res.status(400).json({ success: false, message: "Pet already added. Use update instead." });
    }

    const newPet = new Pet({
      owner: reservation.owner,
      petName: reservation.pets[0].petName,
      species: "Unknown",
      addedFromReservation: true
    });
    await newPet.save();
    
    reservation.pets[0].petId = newPet._id;
    reservation.pets[0].petName = newPet.petName;
    reservation.petAdded = true;
    await reservation.save();
    
    return res.json({ success: true, pet: newPet });
  } catch (error) {
    console.error("Error adding pet from reservation:", error);
    return res.status(500).json({ success: false, message: "Server error while adding pet" });
  }
});

// Update pet from reservation (called when HR clicks "Done")
router.post('/update-pet-from-reservation', authMiddleware, validateRequest(reservationIdSchema), async (req, res) => {
  try {
    const { reservationId, consultationNotes, medications } = req.body;
    const reservation = await Reservation.findById(reservationId);
    if (!reservation) {
      return res.status(404).json({ success: false, message: "Reservation not found" });
    }
    if (!reservation.pets || reservation.pets.length === 0) {
      return res.status(400).json({ success: false, message: "No pet data in this reservation" });
    }
    const petId = reservation.pets[0].petId;
    const pet = await Pet.findById(petId);
    if (!pet) {
      return res.status(404).json({ success: false, message: "Pet not found" });
    }
    const latestPetDetails = reservation.pets[0];
    pet.petName = latestPetDetails.petName || pet.petName;
    await pet.save();

    if (consultationNotes !== undefined) {
      reservation.consultationNotes = consultationNotes;
    }
    if (medications !== undefined) {
      reservation.medications = medications;
    }
    if (reservation.status !== 'Done') {
      reservation.status = 'Done';
    }
    reservation.petAdded = true;
    await reservation.save();

    return res.json({
      success: true,
      reservation,
      message: `Pet ${pet.petName} successfully updated with new consultation data`
    });
  } catch (error) {
    console.error("Error updating pet from reservation:", error);
    return res.status(500).json({ success: false, message: "Server error while updating pet" });
  }
});
router.get('/get-pet-history', authMiddleware, async (req, res) => {
  try {
    // Expect petId, petName, and ownerId (as a string) from the query.
    const { petId, petName, ownerId } = req.query;
    if (!petId && !petName) {
      return res.json({ success: false, message: 'petId or petName is required' });
    }
    
    let query = { status: 'Done' };

    if (petId) {
      // Use an $or clause:
      // - Either the reservation references the pet using the petId exactly,
      // - Or it references the pet via petName and the same owner.
      query.$or = [
        { 'pets.petId': petId },
        { 'pets.petName': petName, owner: ownerId }
      ];
    } else {
      // Fallback if no petId is provided.
      query['pets.petName'] = petName;
      query.owner = ownerId;
    }
    
    // Sort by updatedAt descending so the most recent consultation appears first.
    const history = await Reservation.find(query)
      .populate('doctor', 'username')
      .sort({ updatedAt: -1 })
      .lean();
      
    return res.json({ success: true, history });
  } catch (error) {
    console.error("Error fetching pet history (HR):", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});


module.exports = router;
