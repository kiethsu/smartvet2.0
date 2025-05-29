// customerRoutes.js
const CANCEL_THRESHOLD = 2;    // how many cancels before suspension
const SUSPEND_DAYS     = 1;    // suspension length
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const User = require("../models/user");
const Pet = require('../models/pet');
const multer = require('multer');
const Reservation = require('../models/reservation');
const AppointmentSetting = require('../models/appointmentSetting');
const DashboardSetting = require('../models/dashboardSetting');
const Joi = require('joi');
const nodemailer = require('nodemailer');
const bcrypt = require("bcryptjs");
const PetList = require('../models/petlist');
const Consultation = require('../models/consultation');
const pdf = require('html-pdf');

// Helper to send “almost there” warning
async function sendWarningEmail(toEmail, cancelCount) {
  const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.SMTP_EMAIL,
      pass: process.env.SMTP_PASS
    }
  });
  await transporter.sendMail({
    from: `"SmartVet Support" <dehe.marquez.au@phinmaed.com>`,

    to: toEmail,
    subject: "Careful – One More Cancellation Will Suspend You",
    html: `
      <p>You’ve cancelled ${cancelCount} out of ${CANCEL_THRESHOLD} allowed consultations.</p>
      <p>If you cancel one more, your account will be suspended from submitting new consultations for ${SUSPEND_DAYS} day(s).</p>
      <p>Please make sure you really want to cancel next time.</p>
    `
  });
}


// Import the PetDetailsSetting model
const PetDetailsSetting = require('../models/petDetailsSetting');
// Temporary in-memory store for email update OTPs (for demo purposes only)
let emailUpdateOtpStore = {};
    // For registration OTP
// -------------------- Helper Functions --------------------
// Helper to send suspension email
async function sendSuspensionEmail(toEmail) {
  const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.SMTP_EMAIL,
      pass: process.env.SMTP_PASS
    }
  });
  await transporter.sendMail({
   from: `"SmartVet Support" <dehe.marquez.au@phinmaed.com>`,
    to: toEmail,
    subject: "Consultation Submission Suspended",
    html: `
      <p>You have cancelled too many consultations.</p>
      <p>Your account is suspended from submitting new consultations for ${SUSPEND_DAYS} days.</p>
      <p>If you think this is an error, reply to this email.</p>
    `
  });
}
 // helper → always grab the up-to-date user record
async function checkNotSuspended(req, res, next) {
  const freshUser = await User.findById(req.user.userId);
  if (freshUser.isSuspended) {
    return res
      .status(403)
      .json({
        success: false,
        suspended: true,
        message: 'Your account is suspended from submitting consultations.'
      });
  }
  next();
}


 
// Convert video URLs to embed format
function convertToEmbedUrl(url) {
  if (!url) return url;
  if (url.includes("youtube.com/watch?v=")) {
    return url.replace("watch?v=", "embed/");
  }
  if (url.includes("drive.google.com/file/d/")) {
    const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return `https://drive.google.com/file/d/${match[1]}/preview`;
    }
  }
  return url;
}

// Validation middleware helper
function validateRequest(schema, property = 'body') {
  return (req, res, next) => {
    const { error } = schema.validate(req[property]);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }
    next();
  };
}

// -------------------- Joi Schemas --------------------

// Schema for updating profile details
const updateProfileSchema = Joi.object({
  fullName: Joi.string().min(1).required(),
  address: Joi.string().optional().allow(""),
  cellphone: Joi.string().optional().allow("")
});

// Schema for adding a pet
const addPetSchema = Joi.object({
  petName: Joi.string().required(),
  species: Joi.string().required(),
  breed: Joi.string().optional().allow(""),
  birthday: Joi.date().optional().allow(null),
  existingDisease: Joi.string().optional().allow(""),
  sex: Joi.string().optional().allow(""),
  petPic: Joi.string().optional().allow("")
});

// Schema for submitting a reservation
const submitReservationSchema = Joi.object({
  selectedPets: Joi.array().min(1).required(),
  service: Joi.string().required(),
  date: Joi.date().required(),
  time: Joi.string().required(),
  concerns: Joi.string().optional().allow("")
});

// Schema for reservation ID validation (for query parameters)
const reservationIdSchema = Joi.object({
  reservationId: Joi.string().required()
});

// -------------------- Routes --------------------

// Dashboard route
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const username = req.user.username || req.user.email;
    const now = new Date();

    // grab any reservation with a follow-up in the future
    const upcomingVisits = await Reservation.find({
      owner: req.user.userId,
      'schedule.scheduleDate': { $gte: now }
    })
    .populate('pets.petId', 'petName')  // so visit.pets[i].petId.petName is available
    .sort({ 'schedule.scheduleDate': 1 })
    .lean();

    // your recent “Done” visits
    const recentVisits = await Reservation.find({
      owner: req.user.userId,
      status: 'Done'
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

    let dashboardSetting = await DashboardSetting.findOne().lean();
    if (dashboardSetting && dashboardSetting.videoUrl) {
      dashboardSetting.videoUrl = convertToEmbedUrl(dashboardSetting.videoUrl);
    }

    res.render('customer/dashboard', {
      username,
      upcomingVisits,
      recentVisits,
      dashboardSetting
    });
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res.status(500).send("Server error");
  }
});

// customerRoutes.js

// customerRoutes.js

router.get('/mypet', authMiddleware, async (req, res) => {
  try {
    // 1) fetch real pets
    const pets = await Pet.find({ owner: req.user.userId }).lean();

    // 2) fetch walk-in entries
    const petListEntries = await PetList.find({ owner: req.user.userId }).lean();

    // 3) de-dupe by name
    const existingNames = new Set(pets.map(p => p.petName));
    const walkInPets = petListEntries
      .filter(e => !existingNames.has(e.petName))
      .map(e => ({
        _id:                    `list-${e._id}`,
        petName:                e.petName,
        species:                e.species    || '',
        breed:                  e.breed      || '',
        birthday:               '',
        existingDisease:        '',
        sex:                    '',
        petPic:                 '',
        addedFromReservation:   true
      }));

    // 4) merge
    const allPets = [ ...pets, ...walkInPets ];

    // 5) fetch dropdown settings
    let petDetails = await PetDetailsSetting.findOne().lean();
    if (!petDetails) {
      petDetails = { species: [], speciesBreeds: {}, diseases: [], services: [] };
    }

    // 6) render **and** pass petListEntries so the template can still see it if it needs to
    res.render('customer/mypet', {
      pets:             allPets,
      petListEntries,              // ← now defined in your EJS
      petDetails
    });
  } catch (error) {
    console.error("Error fetching My Pet data:", error);
    res.status(500).send("Server error");
  }
});


// Consult route
// customerRoutes.js

router.get('/consult', authMiddleware, async (req, res) => {
  try {
    const pets = await Pet.find({ owner: req.user.userId });
    const reservations = await Reservation.find({ owner: req.user.userId })
                                          .sort({ createdAt: -1 })
                                          .populate('doctor', 'username')
                                          .lean();
    const petDetails = (await PetDetailsSetting.findOne().lean()) 
                         || { species: [], breeds: [], diseases: [], services: [] };

    // pull the fresh user record
    const freshUser = await User.findById(req.user.userId).lean();

    res.render('customer/consult', {
      pets,
      reservations,
      petDetails,
      user: freshUser,
      error: req.flash('error'),
        threshold: CANCEL_THRESHOLD 
    });
  } catch (error) {
    console.error("Error fetching pets/reservations for consult:", error);
    res.status(500).send("Server error");
  }
});


// Profile Details route
router.get('/profileDetails', authMiddleware, async (req, res) => {
  try {
    const userData = await User.findById(req.user.userId);
    res.render('customer/profileDetails', { user: userData });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});


// Update Profile Details route with validation
router.post('/update-profile-details', authMiddleware, validateRequest(updateProfileSchema), async (req, res) => {
  try {
    const { fullName, address, cellphone } = req.body;
    const userId = req.user.userId;
    const existingUser = await User.findOne({ 
      username: { $regex: `^${fullName}$`, $options: "i" },
      _id: { $ne: userId }
    });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "This full name is already taken." });
    }
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { username: fullName, address, cellphone },
      { new: true }
    );
    return res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
});

// Configure multer for file uploads (profile image)
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, 'public/uploads/');
  },
  filename: function(req, file, cb) {
    const ext = file.originalname.split('.').pop();
    cb(null, req.user.userId + '-' + Date.now() + '.' + ext);
  }
});
const upload = multer({ storage: storage });
router.post('/update-profile-image', authMiddleware, upload.single('profilePic'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }
    const fileUrl = '/uploads/' + req.file.filename;
    const updatedUser = await User.findByIdAndUpdate(req.user.userId, { profilePic: fileUrl }, { new: true });
    return res.json({ success: true, profilePic: updatedUser.profilePic });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Schema for adding a pet
router.post('/add-pet', authMiddleware, validateRequest(addPetSchema), async (req, res) => {
  try {
    const { petName, species, breed, birthday, existingDisease, sex, petPic } = req.body;
    const owner = req.user.userId;
    const newPet = new Pet({
      owner,
      petName,
      species,
      breed,
      birthday: birthday ? new Date(birthday) : null,
      existingDisease,
      sex,
      petPic
    });
    await newPet.save();
    return res.json({ success: true, pet: newPet });
  } catch (error) {
    console.error("Error saving pet:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Schema for submitting a reservation
router.post(
  '/submit-reservation',
  authMiddleware,          // 1) user must be logged in
  checkNotSuspended,       // 2) block suspended users
  validateRequest(submitReservationSchema),  // 3) validate the payload
  async (req, res) => {  try {
    const ownerId = req.user.userId;
    const ownerName = req.user.username || req.user.email;
    const { selectedPets, service, date, time, concerns } = req.body;

    const startDate = new Date(date);
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + 1);

    const existingCount = await Reservation.countDocuments({
      time: time,
      date: { $gte: startDate, $lt: endDate },
      status: { $in: ['Pending', 'Approved'] } // Only count active reservations
    });
    

    const setting = await AppointmentSetting.findOne();
    const limit = setting ? setting.limitPerHour : 5;

    if (existingCount >= limit) {
      return res.status(400).json({ success: false, message: "This time slot is full." });
    }

    const userProfile = await User.findById(ownerId);
    console.log("User Profile:", userProfile);

    const newReservation = new Reservation({
      owner: ownerId,
      ownerName,
      pets: selectedPets,
      service,
      date: date ? new Date(date) : null,
      time,
      concerns,
      status: 'Pending',
      address: userProfile.address || "",
      phone: userProfile.cellphone || ""
    });

    await newReservation.save();
    return res.json({ success: true, reservation: newReservation });
  } catch (error) {
    console.error("Error submitting reservation:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Endpoint to get appointment count for a given time and date
router.post('/cancel-reservation', authMiddleware, async (req, res) => {
  try {
    // 1) Find reservation
    const { reservationId } = req.body;
    const reservation = await Reservation.findOne({
      _id: reservationId,
      owner: req.user.userId
    });
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found.' });
    }

    // 2) Increment & check user suspension
    const user = await User.findById(req.user.userId);
    user.cancelCount = (user.cancelCount || 0) + 1;

// 1) just a warning email when they're at threshold-1
if (user.cancelCount === CANCEL_THRESHOLD - 1) {
  await sendWarningEmail(user.email, user.cancelCount);
}

// 2) only suspend once they've reached the full threshold
if (user.cancelCount >= CANCEL_THRESHOLD) {
  user.isSuspended = true;
  user.suspendedAt  = new Date();
  await sendSuspensionEmail(user.email);
}

await user.save();
    // 3) Update reservation status
    reservation.status = reservation.status === 'Pending'
      ? 'CanceledPending'
      : 'Canceled';
    reservation.canceledAt = new Date();
    reservation.doctor     = undefined;
    await reservation.save();

    // 4) Respond
    const justSuspended = user.isSuspended && user.cancelCount >= CANCEL_THRESHOLD;
  return res.json({ success: true, reservation, justSuspended,
  cancelCount: user.cancelCount});

  } catch (error) {
    console.error("Error canceling reservation:", error);
    return res.status(500).json({ success: false, message: 'Server error while canceling reservation.' });
  }
});



// Update pet details endpoint
router.put('/update-pet/:id', authMiddleware, async (req, res) => {
  try {
    const petId = req.params.id;
    const { petName, species, breed, birthday, existingDisease, sex } = req.body;
    const updatedPet = await Pet.findOneAndUpdate(
      { _id: petId, owner: req.user.userId },
      {
        petName,
        species,
        breed,
        birthday: birthday ? new Date(birthday) : null,
        existingDisease,
        sex
      },
      { new: true }
    );
    if (!updatedPet) {
      return res.status(404).json({ success: false, message: "Pet not found" });
    }
    return res.json({ success: true, pet: updatedPet });
  } catch (error) {
    console.error("Error updating pet:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Delete pet endpoint
router.post('/delete-pet', authMiddleware, async (req, res) => {
  try {
    const petId = req.body.id;
    if (!petId) {
      return res.status(400).json({ success: false, message: 'Pet ID is required' });
    }
    const deletedPet = await Pet.findOneAndDelete({ _id: petId, owner: req.user.userId });
    if (!deletedPet) {
      return res.status(404).json({ success: false, message: 'Pet not found' });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error("Error deleting pet:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get('/get-pet-details', authMiddleware, async (req, res) => {
  try {
    let petDetails = await PetDetailsSetting.findOne().lean();
    if (!petDetails) {
      petDetails = { species: [], speciesBreeds: {}, diseases: [], services: [] };
    }
    res.json(petDetails);
  } catch (error) {
    console.error("Error fetching pet details:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get consultation details for a reservation
router.get(
  '/get-consultation',
  authMiddleware,
  validateRequest(reservationIdSchema, 'query'),
  async (req, res) => {
    try {
      const { reservationId } = req.query;

      // 1) fetch the reservation
      const reservation = await Reservation.findById(reservationId)
        .populate('doctor', 'username')
        .lean();
      if (!reservation) {
        return res.status(404).json({ success: false, message: 'Reservation not found.' });
      }

      // 2) fetch the consultation
      const consult = await Consultation.findOne({ reservation: reservationId }).lean();

      // 3) merge its fields onto reservation
      if (consult) {
        reservation.physicalExam     = consult.physicalExam;
        reservation.diagnosis        = consult.diagnosis;
        reservation.services         = consult.services;
        reservation.medications      = consult.medications;
        reservation.notes            = consult.notes;
        reservation.confinementStatus = consult.confinementStatus;
      }

      return res.json({ success: true, reservation });
    } catch (error) {
      console.error("Error fetching consultation details:", error);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);


// customerRoutes.js

router.get('/get-pet-history', authMiddleware, async (req, res) => {
  try {
    let { petId, petName, addedFromReservation } = req.query;
    const isWalkIn = addedFromReservation === 'true'
                   && petId
                   && String(petId).startsWith('list-');
    let baseQuery = { status: 'Done', owner: req.user.userId };

    if (addedFromReservation === 'false' || !petId || isWalkIn) {
      baseQuery['pets.petName'] = petName;
    } else {
      baseQuery.$or = [
        { 'pets.petId': petId },
        { 'pets.petName': petName }
      ];
    }

    // 1) fetch the list of matching reservations
    const reservations = await Reservation.find(baseQuery)
      .populate('doctor', 'username')
      .lean();

    // 2) for each reservation, also fetch and merge its Consultation
    const history = await Promise.all(reservations.map(async (r) => {
      const consult = await Consultation.findOne({ reservation: r._id }).lean();
      if (consult) {
        r.physicalExam      = consult.physicalExam;
        r.diagnosis         = consult.diagnosis;
        r.services          = consult.services;
        r.medications       = consult.medications;
        r.notes             = consult.notes;
        r.confinementStatus = consult.confinementStatus;
      }
      return r;
    }));

    return res.json({ success: true, history });
  } catch (err) {
    console.error("Error fetching pet history:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});


// In customerRoutes.js, after your other routes:

router.post('/send-email-otp', authMiddleware, async (req, res) => {
  try {
    const { newEmail } = req.body;
    if (!newEmail) {
      return res.status(400).json({ success: false, message: "New email is required." });
    }
    // Check if email is already taken
    const existingUser = await User.findOne({ email: newEmail });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "This email is already in use." });
    }
    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    // Save OTP along with the new email and a timestamp
    emailUpdateOtpStore[req.user.userId] = { otp, newEmail, createdAt: new Date() };
    
    // Configure nodemailer transporter
    const transporter = nodemailer.createTransport({
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASS
      }
    });
    
    const mailOptions = {
      from: '"SmartVet" <dehe.marquez.au@phinmaed.com>',
      to: newEmail,
      subject: "Email Update OTP",
      text: `Your OTP code for email update is: ${otp}. It expires in 10 minutes.`
    };
    
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Error sending OTP email:", error);
        return res.status(500).json({ success: false, message: "Failed to send OTP email." });
      }
      return res.json({ success: true, message: "OTP sent to new email." });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

router.post('/update-email', authMiddleware, async (req, res) => {
  try {
    const { newEmail, emailOTP } = req.body;
    const otpData = emailUpdateOtpStore[req.user.userId];
    if (!otpData) {
      return res.status(400).json({ success: false, message: "No OTP request found. Please request an OTP first." });
    }
    // Check if OTP is expired (10 minutes)
    const now = new Date();
    if ((now - otpData.createdAt) > 10 * 60 * 1000) {
      delete emailUpdateOtpStore[req.user.userId];
      return res.status(400).json({ success: false, message: "OTP expired. Please request a new one." });
    }
    if (otpData.otp !== emailOTP || otpData.newEmail !== newEmail) {
      return res.status(400).json({ success: false, message: "Invalid OTP or email mismatch." });
    }
    // Update user's email
    const updatedUser = await User.findByIdAndUpdate(req.user.userId, { email: newEmail }, { new: true });
    // Clear the OTP data
    delete emailUpdateOtpStore[req.user.userId];
    return res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});
router.post('/update-password', authMiddleware, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters long." });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const updatedUser = await User.findByIdAndUpdate(req.user.userId, { password: hashedPassword }, { new: true });
    return res.json({ success: true, message: "Password updated successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});
// used by your consult.ejs time-slot checker
router.get('/consult/appointmentCount', authMiddleware, async (req, res) => {
  const { time, date } = req.query;
  const start = new Date(date);
  const end = new Date(date);
  end.setDate(end.getDate() + 1);

  const count = await Reservation.countDocuments({
    time,
    date: { $gte: start, $lt: end },
    status: { $in: ['Pending','Approved'] }
  });
  res.json({ count });
});
// in customerRoutes.js, above your module.exports
router.get('/get-pets', authMiddleware, async (req, res) => {
  try {
    const pets = await Pet.find({ owner: req.user.userId })
                          .lean()
                          .sort({ petName: 1 });
    res.json({ success: true, pets });
  } catch (err) {
    console.error("Error fetching pets:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
router.get('/prescription/:reservationId', authMiddleware, async (req, res) => {
  try {
   const { reservationId } = req.params;
    const reservation = await Reservation.findById(reservationId)
      .populate('doctor', 'username')
      .lean();
    if (!reservation) return res.status(404).send('Reservation not found');

    const consult = await Consultation.findOne({ reservation: reservationId }).lean();
    if (consult) reservation.medications = consult.medications;

    // render the EJS to a HTML string
    res.render('customer/prescription', { reservation }, (err, html) => {
      if (err) {
       console.error('EJS render error:', err);
        return res.status(500).send('Error rendering prescription');
      }
      // convert HTML to PDF
      pdf.create(html, { format: 'A4' }).toStream((err, stream) => {
        if (err) {
         console.error('PDF creation error:', err);
          return res.status(500).send('Error generating PDF');
        }
        // set headers so browser will download
        res.setHeader('Content-Type', 'application/pdf');
       res.setHeader(
          'Content-Disposition',
         `attachment; filename=prescription_${reservationId}.pdf`
        );
        stream.pipe(res);
      });
    });
  } catch (err) {
    console.error('Prescription route error:', err);
    res.status(500).send('Server error generating prescription');
  }
});

module.exports = router;
