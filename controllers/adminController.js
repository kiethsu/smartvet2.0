// adminController.js
const bcrypt = require("bcryptjs");
const User = require("../models/user");
const jwt = require("jsonwebtoken");
const path = require('path');
const Pet = require("../models/pet");
const Reservation = require("../models/reservation");
const About = require("../models/about");
const PetDetailsSetting = require("../models/petDetailsSetting");
/**
 * Create a new Doctor/HR account
 */
exports.createAccount = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "All fields are required!" });
    }
    if (!["Doctor", "HR"].includes(role)) {
      return res.status(400).json({ message: "Invalid role! Only Doctor or HR can be created." });
    }
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email is already in use!" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username: name,
      email,
      password: hashedPassword,
      role,
      status: "Active"
    });
    await newUser.save();
    const token = jwt.sign(
      { userId: newUser._id, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    res.status(201).json({
      message: `Successfully created ${role} account!`,
      user: newUser,
      token,
      redirect: role === "Doctor" ? "/doctor-dashboard" : "/hr-dashboard"
    });
  } catch (error) {
    console.error("Error creating account:", error);
    res.status(500).json({ message: "Server error creating account." });
  }
};

/**
 * Get all accounts (excluding Customers)
 */
exports.getAccounts = async (req, res) => {
  try {
    const { search } = req.query;
    let query = { role: { $in: ["Doctor", "HR"] } };
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } }
      ];
    }
    const users = await User.find(query).select("-password");
    res.status(200).json({ users });
  } catch (error) {
    console.error("Error getting accounts:", error);
    res.status(500).json({ message: "Server error retrieving accounts." });
  }
};

/**
 * Reset an account (only for Doctor/HR)
 */
exports.resetAccount = async (req, res) => {
  try {
    const { userId, newEmail, newPassword } = req.body;
    const user = await User.findById(req.body.userId);
    if (!user) {
      return res.status(404).json({ message: "Account not found!" });
    }
    if (!["Doctor", "HR"].includes(user.role)) {
      return res.status(400).json({ message: "Only Doctor and HR accounts can be reset!" });
    }
    if (newEmail) {
      const existingEmail = await User.findOne({ email: newEmail });
      if (existingEmail && existingEmail._id.toString() !== user._id.toString()) {
        return res.status(400).json({ message: "That email is already in use!" });
      }
      user.email = newEmail;
    }
    if (newPassword) {
      user.password = await bcrypt.hash(newPassword, 10);
    }
    await user.save();
    res.status(200).json({ message: "Account updated successfully!" });
  } catch (error) {
    console.error("Error resetting account:", error);
    res.status(500).json({ message: "Server error resetting account." });
  }
};

/**
 * Delete an account (only for Doctor/HR)
 */
exports.deleteAccount = async (req, res) => {
  try {
    const user = await User.findById(req.body.userId);
    if (!user) {
      return res.status(404).json({ message: "Account not found!" });
    }
    if (!["Doctor", "HR"].includes(user.role)) {
      return res.status(400).json({ message: "Only Doctor and HR accounts can be deleted!" });
    }
    await User.findByIdAndDelete(req.body.userId);
    res.status(200).json({ message: "Account deleted successfully." });
  } catch (error) {
    console.error("Error deleting account:", error);
    res.status(500).json({ message: "Server error deleting account." });
  }
};

/**
 * Get account details
 */
exports.getAccountProfile = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    res.status(200).json({ user });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ message: "Server error fetching profile." });
  }
};

/**
 * Update profile (including profile pic)
 */
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.body.userId;
    if (!userId) {
      return res.status(400).json({ success: false, message: "User id is required." });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    if (req.body.username) {
      user.username = req.body.username;
    }
    if (req.body.email) {
      user.email = req.body.email;
    }
    if (req.body.password) {
      const hashedPassword = await bcrypt.hash(req.body.password, 10);
      user.password = hashedPassword;
    }
    if (req.file) {
      user.profilePic = '/uploads/' + req.file.filename;
    }
    await user.save();
    return res.status(200).json({ success: true, user });
  } catch (error) {
    console.error("Error updating profile:", error);
    return res.status(500).json({ success: false, message: "Server error updating profile." });
  }
};

// NEW: Update OTP Setting Endpoint for Admin
exports.updateOTPSetting = async (req, res) => {
  try {
    const { userId, otpEnabled } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required." });
    }
    const user = await User.findById(userId);
    if (!user || user.role !== "Admin") {
      return res.status(404).json({ success: false, message: "Admin user not found." });
    }
    user.otpEnabled = otpEnabled;
    await user.save();
    res.status(200).json({ success: true, message: "OTP setting updated.", user });
  } catch (error) {
    console.error("Error updating OTP setting:", error);
    res.status(500).json({ success: false, message: "Server error updating OTP setting." });
  }
};

/**
 * Get Dashboard Statistics
 */
/**
 * Get Dashboard Statistics
 */
exports.getDashboardStats = async (req, res) => {
  try {
    // --- 1. Appointment Trends (Past 7 Days) ---
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const past7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      past7Days.push(d);
    }
    const labels = past7Days.map(d => d.toISOString().slice(0, 10));
    const pendingCounts = [];
    const approvedCounts = [];
    const completedCounts = [];
    for (let d of past7Days) {
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      const pending = await Reservation.countDocuments({ status: "Pending", createdAt: { $gte: start, $lte: end } });
      const approved = await Reservation.countDocuments({ status: "Approved", createdAt: { $gte: start, $lte: end } });
      const completed = await Reservation.countDocuments({ status: "Done", createdAt: { $gte: start, $lte: end } });
      pendingCounts.push(pending);
      approvedCounts.push(approved);
      completedCounts.push(completed);
    }

    // --- 2. Most Used Services (Top 3, only counting completed consultations) ---
    const servicesAgg = await Reservation.aggregate([
      { $match: { status: "Done" } }, // Only count consultations that are completed
      { $group: { _id: "$service", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    const top3Services = servicesAgg.slice(0, 3);
    const servicesLabels = top3Services.map(item => item._id);
    const servicesData = top3Services.map(item => item.count);

    // --- 3. Pets by Species (removing breed text) ---
    // Aggregate the total count of pets per species.
    const petsSpeciesAgg = await Pet.aggregate([
      { $group: { _id: "$species", count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    const speciesLabels = petsSpeciesAgg.map(item => item._id);
    const speciesData = petsSpeciesAgg.map(item => item.count);
    // Create a single dataset for the bar chart.
    const petsDataset = {
      label: "Pets", // The label no longer mentions breed
      data: speciesData,
      backgroundColor: "rgba(75, 192, 192, 0.7)",
    };

    // --- 4. Disease Analytics ---
    const diseaseAgg = await Pet.aggregate([
      { $match: { existingDisease: { $nin: ["", "None"] } } },
      { $group: { _id: "$existingDisease", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    const diseaseLabels = diseaseAgg.map(item => item._id);
    const diseaseData = diseaseAgg.map(item => item.count);

    // --- 5. User Account Statistics ---
    const doctorsCount = await User.countDocuments({ role: "Doctor" });
    const hrCount = await User.countDocuments({ role: "HR" });
    const customersCount = await User.countDocuments({ role: "Customer" });

    // --- 6. Activity Feed ---
    const recentReservations = await Reservation.find({})
      .sort({ createdAt: -1 })
      .limit(3)
      .lean();
    const recentUsers = await User.find({ role: { $in: ["Doctor", "HR", "Customer"] } })
      .sort({ createdAt: -1 })
      .limit(2)
      .lean();
    const activityFeed = [];
    recentUsers.forEach(u => {
      activityFeed.push(`${u.role} ${u.username} account created`);
    });
    recentReservations.forEach(r => {
      activityFeed.push(`Reservation by ${r.ownerName} (${r.service})`);
    });

    const dashboardStats = {
      appointmentTrends: { labels, pending: pendingCounts, approved: approvedCounts, completed: completedCounts },
      servicesData: { labels: servicesLabels, data: servicesData },
      petsData: { labels: speciesLabels, datasets: [petsDataset] },
      diseaseData: { labels: diseaseLabels, data: diseaseData },
      userStats: { doctors: doctorsCount, hr: hrCount, customers: customersCount },
      activityFeed
    };

    res.json(dashboardStats);
  } catch (error) {
    console.error("Error in getDashboardStats:", error);
    res.status(500).json({ error: "Server error" });
  }
};

exports.getAbout = async (req, res) => {
  try {
    let aboutContent = await About.findOne();
    if (!aboutContent) {
      // Default object if none exists
      aboutContent = { aboutDescription: "", doctors: [] };
    }
    res.render("about", { about: aboutContent });
  } catch (error) {
    console.error("Error fetching about content:", error);
    res.status(500).send("Server error fetching about content");
  }
};

exports.updateAbout = async (req, res) => {
  try {
    // Retrieve fields from the request
    const { aboutDescription, doctorName, doctorDescription, services } = req.body;
    let doctorPic = "";
    if (req.file) {
      doctorPic = "/uploads/" + req.file.filename;
    }
    let aboutContent = await About.findOne();
    if (!aboutContent) {
      aboutContent = new About();
    }
    // Update the general about description
    aboutContent.aboutDescription = aboutDescription;

    // Update services field:
    // Expecting services to be entered one per line in the textarea
    if (services !== undefined) {
      aboutContent.services = services
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(s => s !== "");
    }
    
    // If a new doctor is added, push a new doctor object (only if a name is provided)
    if (doctorName && doctorName.trim() !== "") {
      aboutContent.doctors.push({
        name: doctorName,
        description: doctorDescription,
        pic: doctorPic
      });
    }
    
    await aboutContent.save();
    res.json({ success: true, message: "About content updated successfully", about: aboutContent });
  } catch (error) {
    console.error("Error updating about content:", error);
    res.status(500).json({ success: false, message: "Server error updating about content" });
  }
};

exports.deleteDoctor = async (req, res) => {
  try {
    const { doctorId } = req.body;
    if (!doctorId) {
      return res.status(400).json({ success: false, message: "Doctor ID is required" });
    }
    let aboutContent = await About.findOne();
    if (!aboutContent) {
      return res.status(404).json({ success: false, message: "About content not found" });
    }
    // Try to get the doctor subdocument
    const doctor = aboutContent.doctors.id(doctorId);
    if (doctor && typeof doctor.remove === "function") {
      doctor.remove();
    } else {
      // If doctor.remove() is not available, remove manually:
      aboutContent.doctors = aboutContent.doctors.filter(doc => doc._id.toString() !== doctorId);
    }
    await aboutContent.save();
    res.json({ success: true, message: "Doctor removed successfully", about: aboutContent });
  } catch (error) {
    console.error("Error deleting doctor:", error);
    res.status(500).json({ success: false, message: "Server error deleting doctor" });
  }
};
