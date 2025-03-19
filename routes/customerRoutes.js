// customerRoutes.js
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

// Import the PetDetailsSetting model
const PetDetailsSetting = require('../models/petDetailsSetting');
// Temporary in-memory store for email update OTPs (for demo purposes only)
let emailUpdateOtpStore = {};
    // For registration OTP
// -------------------- Helper Functions --------------------

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
    const upcomingVisits = await Reservation.find({
      owner: req.user.userId,
      schedule: { $exists: true },
      'schedule.scheduleDate': { $gte: new Date() }
    }).sort({ 'schedule.scheduleDate': 1 }).lean();

    const recentVisits = await Reservation.find({
      owner: req.user.userId,
      status: 'Done'
    }).sort({ createdAt: -1 }).limit(5).lean();
    
    let dashboardSetting = await DashboardSetting.findOne().lean();
    if (dashboardSetting && dashboardSetting.videoUrl) {
      dashboardSetting.videoUrl = convertToEmbedUrl(dashboardSetting.videoUrl);
    }
    
    res.render('customer/dashboard', { username, upcomingVisits, recentVisits, dashboardSetting });
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res.status(500).send("Server error");
  }
});

// My Pet route
router.get('/mypet', authMiddleware, async (req, res) => {
  try {
    const pets = await Pet.find({ owner: req.user.userId, addedFromReservation: { $ne: true } });
    let petDetails = await PetDetailsSetting.findOne().lean();
    if (!petDetails) {
      petDetails = { species: [], speciesBreeds: {}, diseases: [], services: [] };
    }
    res.render('customer/mypet', { pets, petDetails });
  } catch (error) {
    console.error("Error fetching My Pet data:", error);
    res.status(500).send("Server error");
  }
});

// Consult route
router.get('/consult', authMiddleware, async (req, res) => {
  try {
    const pets = await Pet.find({ owner: req.user.userId });
    const reservations = await Reservation.find({ owner: req.user.userId })
                                          .sort({ createdAt: -1 })
                                          .populate('doctor', 'username')
                                          .lean();
    let petDetails = await PetDetailsSetting.findOne().lean();
    if (!petDetails) {
      petDetails = { species: [], breeds: [], diseases: [] };
    }
    res.render('customer/consult', { pets, reservations, petDetails });
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
router.post('/submit-reservation', authMiddleware, validateRequest(submitReservationSchema), async (req, res) => {
  try {
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
    const { reservationId } = req.body;
    const reservation = await Reservation.findOne({
      _id: reservationId,
      owner: req.user.userId
    });
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found.' });
    }
    
    // Use a different status if canceling a pending reservation
    if (reservation.status === 'Pending') {
      reservation.status = 'CanceledPending';
    } else {
      reservation.status = 'Canceled';
    }
    reservation.canceledAt = new Date();
    reservation.doctor = undefined;
    await reservation.save();
    
    return res.json({ success: true, reservation });
  } catch (error) {
    console.error("Error canceling reservation:", error);
    res.status(500).json({ success: false, message: 'Server error while canceling reservation.' });
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

// Get consultation details for a reservation (with validation)
router.get('/get-consultation', authMiddleware, validateRequest(reservationIdSchema, 'query'), async (req, res) => {
  try {
    const { reservationId } = req.query;
    const reservation = await Reservation.findById(reservationId)
    .populate('doctor', 'username') // Populate doctor's username
    .lean();    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found.' });
    }
    if (reservation.medications && reservation.medications.length > 0) {
      reservation.medications = reservation.medications.map(med => {
        if (!med.quantity) {
          med.quantity = "N/A";
        }
        return med;
      });
    }
    
    res.json({ success: true, reservation });
  } catch (error) {
    console.error("Error fetching consultation details:", error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/get-pet-history', authMiddleware, async (req, res) => {
  try {
    const { petId, petName, addedFromReservation } = req.query;
    if (!petId && !petName) {
      return res.json({ success: false, message: 'petId or petName is required' });
    }
    
    let query = { status: 'Done' };

    // For customers, if the pet was manually added (addedFromReservation = "false")
    // or no petId is provided, match by petName and restrict to the logged-in owner.
    if (addedFromReservation === 'false' || !petId) {
      query['pets.petName'] = petName;
      query.owner = req.user.userId;
    } else {
      // If the pet was added via a reservation, try to match either by petId or petName,
      // still ensuring it belongs to the logged-in customer.
      query.$or = [
        { 'pets.petId': petId },
        { 'pets.petName': petName }
      ];
      query.owner = req.user.userId;
    }
    
    const history = await Reservation.find(query)
      .populate('doctor', 'username')
      .lean();
      
    return res.json({ success: true, history });
  } catch (error) {
    console.error("Error fetching pet history (customer):", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});


// In customerRoutes.js, after your other routes:
router.post('/cancel-reservation', authMiddleware, async (req, res) => {
  try {
    const { reservationId } = req.body;
    const reservation = await Reservation.findOne({
      _id: reservationId,
      owner: req.user.userId
    });
    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found.' });
    }
    // If the consultation is pending, mark it as CanceledPending.
    if (reservation.status === 'Pending') {
      reservation.status = 'CanceledPending';
    } else {
      reservation.status = 'Canceled';
    }
    reservation.canceledAt = new Date();
    reservation.doctor = undefined; // optional: clear doctor assignment if needed
    await reservation.save();
    
    return res.json({ success: true, reservation });
  } catch (error) {
    console.error("Error canceling reservation:", error);
    res.status(500).json({ success: false, message: 'Server error while canceling reservation.' });
  }
});
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

module.exports = router;
