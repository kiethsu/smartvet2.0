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
exports.predictAppointments = async (req, res) => {
  try {
    console.log("Start predictAppointments...");

    // 1) Build dayCounts for last 7 days
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    let dayCounts = [];
    for (let i = 6; i >= 0; i--) {
      const dayDate = new Date(today);
      dayDate.setDate(dayDate.getDate() - i);

      // day start & end
      const start = new Date(dayDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(dayDate);
      end.setHours(23, 59, 59, 999);

      // Count how many reservations
      const dailyCount = await Reservation.countDocuments({
        createdAt: { $gte: start, $lte: end }
      });

      dayCounts.push({
        date: dayDate.toISOString().slice(0, 10),
        count: dailyCount
      });
    }

    console.log("   dayCounts =>", dayCounts);

    // 2) Check if all 7 days are zero
    const allZero = dayCounts.every(dc => dc.count === 0);
    if (allZero) {
      // If truly no data in system, fallback to "0" for next 3 days
      const predictions = [];
      for (let i = 1; i <= 3; i++) {
        const futureDate = new Date(today);
        futureDate.setDate(today.getDate() + i);
        predictions.push({
          date: futureDate.toISOString().slice(0, 10),
          predictedCount: 0
        });
      }
      return res.json({
        last7days: dayCounts,
        method: "fallbackAllZero",
        predictions
      });
    }

    // 3) If there's ANY data, do the naive ratio/diff approach
    console.log("   Some days have non-zero data => ratio/diff approach.");

    // Build arrays of ratio/diffs
    let ratios = [];
    let diffs = [];
    for (let i = 1; i < dayCounts.length; i++) {
      let prev = dayCounts[i - 1].count;
      let curr = dayCounts[i].count;
      if (prev > 0) {
        ratios.push(curr / prev);
      }
      diffs.push(curr - prev);
    }

    let forecastMethod = "";
    let averageGrowth = 1;
    let averageDiff = 0;

    if (ratios.length >= 3) {
      // Use ratio approach
      averageGrowth = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      forecastMethod = "averageRatio";
    } else {
      // Use difference approach
      if (diffs.length > 0) {
        averageDiff = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
      }
      forecastMethod = "averageDiff";
    }

    console.log("   forecastMethod=", forecastMethod, " growth=", averageGrowth, " diff=", averageDiff);

    // 4) Generate predictions for next 3 days
    let predictions = [];
    let lastCount = dayCounts[dayCounts.length - 1].count;
    for (let i = 1; i <= 3; i++) {
      const nextDate = new Date(today);
      nextDate.setDate(today.getDate() + i);

      let nextCount = 0;
      if (forecastMethod === "averageRatio") {
        nextCount = Math.round(lastCount * averageGrowth);
      } else {
        nextCount = lastCount + averageDiff;
      }

      if (nextCount < 0) nextCount = 0; // never go negative
      predictions.push({
        date: nextDate.toISOString().slice(0, 10),
        predictedCount: nextCount
      });

      lastCount = nextCount;
    }

    return res.json({
      last7days: dayCounts,
      method: forecastMethod,
      averageGrowth,
      averageDiff,
      predictions
    });

  } catch (err) {
    console.error("Error in predictAppointments:", err);
    return res.status(500).json({ error: "Server error predicting appointments." });
  }
};
/**
 * Predict the busiest day-of-week for the next 7 days
 */
// adminController.js
exports.getPeakDayOfWeek = async (req, res) => {
  try {
    console.log("[getPeakDayOfWeek] Starting day-of-week analysis...");

    // 1) Determine "30 days ago"
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);

    // 2) Retrieve reservations in the last 30 days
    //    (Adjust the field name if needed, e.g. "createdAt")
    const reservations = await Reservation.find({
      createdAt: { $gte: thirtyDaysAgo, $lte: now }
    }).lean();

    // 3) dayOfWeekCounts: an object, keys are [0..6], values are how many
    //    For easy label, we'll define an array of day names:
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    let dayOfWeekCounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

    // 4) Loop each reservation, find its day-of-week
    reservations.forEach(resv => {
      const day = new Date(resv.createdAt).getDay(); 
      dayOfWeekCounts[day] = (dayOfWeekCounts[day] || 0) + 1;
    });

    // 5) Convert that object to an array: [ { dayLabel, count } ]
    let dayArray = [];
    for (let i = 0; i < 7; i++) {
      dayArray.push({
        dayLabel: dayNames[i],
        count: dayOfWeekCounts[i]
      });
    }

    // 6) Find the top day (peak) by count
    let peakDay = dayArray.reduce((max, current) => current.count > max.count ? current : max, dayArray[0]);

    // Return the result
    return res.json({
      last30daysTotal: reservations.length,
      days: dayArray,      // e.g. [ { dayLabel:"Monday", count:10 }, ... ]
      peakDayOfWeek: peakDay // e.g. { dayLabel:"Monday", count:10 }
    });
  } catch (err) {
    console.error("Error in getPeakDayOfWeek:", err);
    return res.status(500).json({ error: "Server error analyzing day-of-week." });
  }
};
